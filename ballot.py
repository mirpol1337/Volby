"""Read a photo of a Czech municipal-election ballot and print the marked parties and candidates.

Usage:
    python ballot.py sample.jpg [--annotate checked.jpg] [--first-party 21]

How it works:
  1. threshold the photo and find the big rectangular frames - one per party column,
  2. straighten every column with a perspective warp and threshold it again,
  3. find the check boxes (party box on top, then one box per candidate) and measure
     how much ink there is inside each of them,
  4. work out which parties the columns belong to by comparing the number of candidate
     boxes with the official candidate list (columns are expected left to right in
     ballot order; use --first-party if the counts are not distinctive enough).

  5. nobody draws extra boxes: a column has exactly one box per candidate. Where fewer boxes
     were found (usually crossed ones - a sloppy cross joins its box to the text around it),
     the missing boxes are looked for in the gaps between the boxes found, and reported.

A column where the number of boxes still differs from the candidate list is reported as
"NOT READ" instead of guessing which candidate a mark belongs to.
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

CANDIDATES_URL = ("https://www.seznamzpravy.cz/p/vysledky-voleb/2026/komunalni-volby"
                  "/obec/554782-praha/kandidati")
CANDIDATES_FILE = Path(__file__).with_name("candidates.json")

COL_W = 640       # width every party column is rectified to; box sizes are relative to it
MARGIN = 32       # border kept around a rectified column, the paper is never perfectly flat
MARK_FILL = 0.05  # share of ink pixels in the middle of a box that makes it "marked"


def load_parties():
    """Return [{"number", "name", "candidates": [name of no. 1, ...]}, ...]; downloaded on first use."""
    if not CANDIDATES_FILE.exists():
        parties = download_parties()
        CANDIDATES_FILE.write_text(json.dumps(parties, ensure_ascii=False, indent=1), encoding="utf-8")
    return json.loads(CANDIDATES_FILE.read_text(encoding="utf-8"))


def download_parties():
    request = urllib.request.Request(CANDIDATES_URL, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(request, timeout=30).read().decode("utf-8")
    # the page carries its data as one JSON object assigned to $IMA.Cache
    start = html.index("$IMA.Cache = ") + len("$IMA.Cache = ")
    cache, _ = json.JSONDecoder().raw_decode(html, start)
    widget = next(value for key, value in cache.items() if "/widgets/communal/" in key)
    electorate = widget["value"]["body"]["state"]["candidates"]["electorates"][0]

    def full_name(c):
        name = " ".join(filter(None, [c["titleBefore"], c["name"], c["surname"]]))
        return f"{name}, {c['titleAfter']}" if c["titleAfter"] else name

    def names(candidates):
        # indexed by ballot number - 1; a number missing from the list stays None
        by_number = {c["orderNum"]: full_name(c) for c in candidates}
        return [by_number.get(number) for number in range(1, max(by_number) + 1)]

    return [{"number": party["orderNum"],
             "name": party["shortName30"],
             "candidates": names(party["candidates"])}
            for party in sorted(electorate["parties"], key=lambda p: p["orderNum"])]


def binarize(gray, block, strength):
    """Adaptive threshold; ink becomes white (255) and paper black.

    A pixel is ink when it is darker than its neighbourhood by `strength` times the
    contrast between paper and print, so dim or washed-out photos work as well.
    """
    paper, ink = np.percentile(gray, [50, 2])
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                 cv2.THRESH_BINARY_INV, block | 1, strength * (paper - ink))


def find_columns(gray):
    """Find the frames around the party columns; return (contour, corners) left to right."""
    ink = binarize(gray, min(gray.shape) // 70, 0.09)
    ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))  # bridge gaps in lines
    contours, _ = cv2.findContours(ink, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = [contour for contour in contours if cv2.contourArea(contour) > 0.01 * gray.size]
    columns = []
    for contour in sorted(contours, key=cv2.contourArea):
        # the convex hull ignores notches left by boxes or text that touch the frame line
        hull = cv2.convexHull(contour)
        quad = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True).reshape(-1, 2)
        if len(quad) != 4 or cv2.contourArea(contour) < 0.8 * cv2.contourArea(hull):
            continue
        # order the corners: top-left, top-right, bottom-right, bottom-left
        s, d = quad.sum(axis=1), quad[:, 0] - quad[:, 1]
        corners = np.float32([quad[s.argmin()], quad[d.argmax()], quad[s.argmax()], quad[d.argmin()]])
        # A frame shows up twice, as the inner and the outer edge of its line - keep the
        # outer one, unless its corners are elsewhere: a cross whose stroke runs out over the
        # frame line joins the frame to whatever it touches, only the inner edge stays clean.
        # A bigger rectangle around several frames (the sheet) is not a column.
        enclosed = [i for i, (_, other) in enumerate(columns)
                    if cv2.pointPolygonTest(contour, tuple(map(float, other.mean(axis=0))), False) > 0]
        if not enclosed:
            columns.append((contour, corners))
        elif len(enclosed) == 1 and cv2.contourArea(contour) < 1.3 * cv2.contourArea(columns[enclosed[0]][0]):
            inner = columns[enclosed[0]][1]
            if np.abs(corners - inner).max() < 0.05 * np.linalg.norm(inner[1] - inner[0]):
                columns[enclosed[0]] = (contour, corners)
    return sorted(columns, key=lambda column: column[1][:, 0].mean())


def rectify(gray, contour, corners):
    """Warp one column upright; return its binary image (without the frame) and the transform."""
    tl, tr, br, bl = corners
    width = np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)
    height = np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)
    col_h = round(COL_W * height / width)
    target = np.float32([[0, 0], [COL_W, 0], [COL_W, col_h], [0, col_h]]) + MARGIN
    transform = cv2.getPerspectiveTransform(corners, target)
    size = (COL_W + 2 * MARGIN, col_h + 2 * MARGIN)

    column = cv2.warpPerspective(gray, transform, size, flags=cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REPLICATE)
    ink = binarize(column, 51, 0.22)
    # Keep only what lies inside the frame. Closing the mask fills the notches (see
    # find_columns), eroding it removes the frame line itself.
    inside = np.zeros_like(gray)
    cv2.drawContours(inside, [contour], -1, 255, cv2.FILLED)
    inside = cv2.warpPerspective(inside, transform, size, flags=cv2.INTER_NEAREST)
    pad = int(0.15 * COL_W)  # wider than a box, so that no notch survives
    inside = cv2.copyMakeBorder(inside, pad, pad, pad, pad, cv2.BORDER_CONSTANT)
    inside = cv2.morphologyEx(inside, cv2.MORPH_CLOSE, np.ones((pad, pad), np.uint8))[pad:-pad, pad:-pad]
    inside = cv2.erode(inside, np.ones((11, 11), np.uint8))
    return cv2.bitwise_and(ink, inside), transform


def find_boxes(ink):
    """Return the check boxes (x, y, w, h) of a rectified column, top to bottom."""
    # Fill every closed shape: a box turns into a solid blob whether it is crossed or not,
    # while text stays thin strokes. (The size limit skips a frame that was not removed.)
    ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(ink, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(ink)
    for contour in contours:
        if max(cv2.boundingRect(contour)[2:]) < 0.5 * COL_W:
            cv2.drawContours(filled, [contour], -1, 255, cv2.FILLED)
    # Opening with a kernel of half a candidate box removes everything but the solid blobs,
    # including the strokes of a cross that stick out of its box.
    kernel = np.ones((int(0.025 * COL_W), int(0.05 * COL_W)), np.uint8)
    solid = cv2.morphologyEx(filled, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = [cv2.boundingRect(contour) for contour in contours]
    boxes = [(x, y, w, h) for x, y, w, h in boxes
             if w < 0.16 * COL_W and h < 0.16 * COL_W and x + w / 2 < MARGIN + 0.2 * COL_W]
    return sorted(boxes, key=lambda box: box[1])


def fill_ratio(ink, box):
    """Share of ink pixels in the central part of a box (the outline is left out)."""
    x, y, w, h = box
    centre = ink[y + h // 4:y + h - h // 4, x + w // 5:x + w - w // 5]
    return cv2.countNonZero(centre) / centre.size


def complete_boxes(ink, boxes, count):
    """Add the candidate boxes that were not found, so that the column has `count` of them.

    Returns (boxes, indices of the added ones). The ballot has exactly one box per candidate,
    so a missing box is one find_boxes() could not separate - nearly always a crossed one whose
    strokes run into the text or into the next box:
      1. strokes joining two boxes make one box twice as tall - split it;
      2. a box lost in the strokes still leaves its printed outline in the narrow strip of the
         boxes, where otherwise there is only paper between two boxes: look for two nearly full
         rows (its top and bottom edge) a box height apart outside the boxes found;
      3. see below.
    A box put in the wrong place would shift the numbers of all candidates below it, so a box is
    added only where its outline is seen, or where it is the only possible place.
    """
    head, cands = boxes[:1], list(boxes[1:])
    if count - len(cands) <= 0 or len(cands) < 2:
        return boxes, []
    x0 = int(np.median([x for x, y, w, h in cands]))
    bw = int(np.median([w for x, y, w, h in cands]))
    bh = int(np.median([h for x, y, w, h in cands]))
    added = []
    for box in [box for box in cands if box[3] >= 1.6 * bh and box[2] <= 1.3 * bw]:
        if len(cands) >= count:
            break
        x, y, w, h = box
        k = min(round(h / bh), count - len(cands) + 1)
        parts = [(x, int(y + j * (h - bh) / (k - 1)), w, bh) for j in range(k)]
        cands.remove(box)
        cands += parts
        added += parts
    missing = count - len(cands)
    strip = ink[:, x0:x0 + bw]
    row = (strip > 0).mean(axis=1)  # share of ink in every row of the strip
    taken = np.zeros(len(row), bool)
    for x, y, w, h in head + cands:
        taken[max(0, y - 2):y + h + 3] = True
    # only below the party box (or the first candidate box) and down to a few boxes after the last one
    top = (head[0][1] + head[0][3]) if head else cands[0][1]
    pitch = np.median(np.diff(sorted(y for x, y, w, h in cands)))
    bottom = min(len(row) - 1, int(max(y + h for x, y, w, h in cands) + 3 * pitch))
    # every place where a box of about the usual height has both edges, best first
    used = np.concatenate([[0], np.cumsum(taken)])  # used[b + 1] - used[t] = rows taken in t..b
    # (a box `height` rows tall has its edges in rows t and t + height - 1)
    places = [(min(row[t], row[t + height - 1]), t, height)
              for t in range(top, bottom) for height in range(bh - 2, bh + 3)
              if t + height - 1 <= bottom and used[t + height] == used[t] and min(row[t], row[t + height - 1]) >= 0.5]
    found = []
    for score, t, height in sorted(places, reverse=True):
        if len(found) >= missing:
            break
        if not taken[t:t + height].any():
            found.append((x0, t, bw, height))
            taken[max(0, t - 2):t + height + 2] = True
    # 3. a box under heavy strokes can lose its printed lines in the thresholding. If the gaps hold
    #    exactly as many patches of ink as boxes are still missing, those are the crossed boxes
    #    (otherwise it is not clear which gap holds a box: the column stays NOT READ)
    if len(found) < missing:
        runs, y = [], top
        while y <= bottom:
            if taken[y] or row[y] < 0.15:
                y += 1
                continue
            start = y
            while y <= bottom and not taken[y] and row[y:y + 3].max() >= 0.15:
                y += 1
            if y - start >= 0.6 * bh:
                runs.append((start, y))
        if len(runs) == missing - len(found):
            for start, end in runs:
                t = max(start, min(end - bh, (start + end - bh) // 2))
                found.append((x0, t, bw, min(bh, end - t)))
    added += found
    cands = sorted(cands + found, key=lambda box: box[1])
    return head + cands, sorted(1 + cands.index(box) for box in added)


def identify_parties(counts, parties, first_party=None):
    """Return the run of consecutive parties whose candidate counts fit the boxes found."""
    if first_party is not None:
        start = next((i for i, party in enumerate(parties) if party["number"] == first_party), None)
        if start is None or start + len(counts) > len(parties):
            sys.exit(f"--first-party {first_party} does not fit {len(counts)} columns")
    else:
        costs = [sum(abs(len(party["candidates"]) - count)
                     for party, count in zip(parties[i:i + len(counts)], counts))
                 for i in range(len(parties) - len(counts) + 1)]
        if not costs or costs.count(min(costs)) > 1:
            sys.exit(f"cannot tell the parties from the box counts {counts}, use --first-party")
        start = costs.index(min(costs))
    return parties[start:start + len(counts)]


def read_ballot(path, parties, first_party=None, annotate=None):
    """Return [(party, marks, added)] per column; marks[0] is the party box, marks[n] candidate n,
    added = the numbers of the candidate boxes that were not found but filled in (see complete_boxes)."""
    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        sys.exit(f"cannot read image {path}")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    columns = []  # (area of the frame, ink, boxes, transform) for every frame found
    for contour, corners in find_columns(gray):
        ink, transform = rectify(gray, contour, corners)
        columns.append((cv2.contourArea(contour), ink, find_boxes(ink), transform))

    # A frame without boxes is some other rectangle in the photo - unless it is as large
    # as the party columns: then it is a column that could not be read.
    typical = np.median([area for area, _, boxes, _ in columns if len(boxes) > 1] or [0])
    columns = [column for column in columns if len(column[2]) > 1 or 0.5 * typical < column[0] < 2 * typical]

    def draw(column, boxes, added=()):
        _, ink, _, transform = column
        for i, (x, y, w, h) in enumerate(boxes):
            colour = (0, 0, 255) if fill_ratio(ink, (x, y, w, h)) > MARK_FILL else (0, 170, 0)
            for grow in ((0, 4) if i in added else (0,)):  # a filled-in box gets a double outline
                outline = np.float32([[[x - grow, y - grow], [x + w + grow, y - grow], [x + w + grow, y + h + grow], [x - grow, y + h + grow]]])
                outline = cv2.perspectiveTransform(outline, np.linalg.inv(transform))
                cv2.polylines(image, [np.int32(outline)], True, colour, 2)

    def save():
        if annotate:
            cv2.imencode(Path(annotate).suffix, image)[1].tofile(annotate)

    if not columns:
        save()
        sys.exit(f"{path}: no party columns found")
    try:
        found = identify_parties([max(len(column[2]) - 1, 0) for column in columns], parties, first_party)
    except SystemExit:
        for column in columns:
            draw(column, column[2])
        save()
        raise

    result = []
    for party, column in zip(found, columns):
        boxes, added = complete_boxes(column[1], column[2], len(party["candidates"]))
        draw(column, boxes, added)
        result.append((party, [fill_ratio(column[1], box) > MARK_FILL for box in boxes], added))
    save()
    return result


def print_result(columns):
    # A column with a wrong number of boxes was not read properly (a box was missed or
    # something else taken for one): its numbering cannot be trusted, so it is only reported.
    def readable(column):
        party, marks, _ = column
        return len(marks) - 1 == len(party["candidates"])

    unreadable = [column for column in columns if not readable(column)]
    columns = [column for column in columns if readable(column)]

    selected = [party for party, marks, _ in columns if marks[0]]
    print("Selected parties:")
    for party in selected:
        print(f"  {party['number']:>2}  {party['name']}")
    if not selected:
        print("  none")

    print("Selected candidates:")
    with_candidates = [(party, marks) for party, marks, _ in columns if any(marks[1:])]
    for party, marks in with_candidates:
        ignored = "  (party selected - marks of its candidates do not count)" if marks[0] else ""
        print(f"  {party['number']:>2}  {party['name']}{ignored}")
        for number in range(1, len(marks)):
            if marks[number]:
                print(f"        {number:>2}. {party['candidates'][number - 1] or '(not in the candidate list)'}")
    if not with_candidates:
        print("  none")

    filled = [(party, added) for party, _, added in columns if added]
    if filled:
        print("Boxes filled in by the candidate count (not found as boxes, double outline) - check them:")
        for party, added in filled:
            print(f"  {party['number']:>2}  candidates {', '.join(map(str, added))}")
    if len(selected) > 1:
        print(f"Note: {len(selected)} parties are marked - a ballot with more than one party marked is invalid.")
    if unreadable:
        print("NOT READ - check these by hand:")
        for party, marks, _ in unreadable:
            print(f"  {party['number']:>2}  {party['name']}  "
                  f"(found {max(len(marks) - 1, 0)} of {len(party['candidates'])} candidate boxes)")


def main():
    parser = argparse.ArgumentParser(description="Print the parties and candidates marked on a ballot photo.")
    parser.add_argument("images", nargs="+", help="photo(s) of a ballot side")
    parser.add_argument("--first-party", type=int, metavar="N",
                        help="ballot number of the leftmost party in the photo (detected by default)")
    parser.add_argument("--annotate", metavar="FILE",
                        help="save a copy of the photo with the boxes outlined (red = marked)")
    args = parser.parse_args()
    if args.annotate and len(args.images) > 1:
        parser.error("--annotate works with a single image")
    sys.stdout.reconfigure(errors="replace")  # the names are Czech, the console may not be

    parties = load_parties()
    for path in args.images:
        columns = read_ballot(path, parties, args.first_party, args.annotate)
        print(f"{path}: parties {columns[0][0]['number']}-{columns[-1][0]['number']}")
        print_result(columns)


if __name__ == "__main__":
    main()
