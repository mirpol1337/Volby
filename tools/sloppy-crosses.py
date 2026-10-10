"""Paints sloppy crosses (thick strokes overshooting into the text and the neighbouring boxes) onto
a photo of a ballot page, at the boxes ballot.py finds there - for regression photos of badly
drawn crosses (tests/fixtures/ballot-21-24-sloppy/).
Usage: python3 tools/sloppy-crosses.py photo.jpg out.jpg SEED PARTY:CAND|PARTY:P ... [--overshoot 0.1,0.5] [--width 3,4,5]
Needs candidates.json next to ballot.py (see ballot.py)."""
import argparse
import random
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ballot  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("photo")
parser.add_argument("out")
parser.add_argument("seed", type=int)
parser.add_argument("targets", nargs="+")
parser.add_argument("--overshoot", default="0.1,0.5", help="how far a stroke runs past the box, in box sizes (min,max)")
parser.add_argument("--width", default="3,4,5", help="stroke widths in pixels to pick from")
args = parser.parse_args()
lo, hi = map(float, args.overshoot.split(","))
widths = list(map(int, args.width.split(",")))
rng = random.Random(args.seed)

image = cv2.imread(args.photo)
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
columns = []
for contour, corners in ballot.find_columns(gray):
    ink, transform = ballot.rectify(gray, contour, corners)
    boxes = ballot.find_boxes(ink)
    if len(boxes) > 1:
        columns.append((boxes, np.linalg.inv(transform)))
found = ballot.identify_parties([len(boxes) - 1 for boxes, _ in columns], ballot.load_parties())
where = {party["number"]: column for party, column in zip(found, columns)}
for target in args.targets:
    party, cand = target.split(":")
    boxes, back = where[int(party)]
    x, y, w, h = boxes[0 if cand == "P" else int(cand)]
    q = cv2.perspectiveTransform(np.float32([[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]), back)[0]
    bw, bh = q[1][0] - q[0][0], q[3][1] - q[0][1]
    over = lambda: rng.uniform(lo, hi)  # noqa: E731
    for x1, y1, x2, y2 in [(q[0][0] - over() * bw, q[0][1] - over() * bh, q[2][0] + over() * bw, q[2][1] + over() * bh),
                           (q[1][0] + over() * bw, q[1][1] - over() * bh, q[3][0] - over() * bw, q[3][1] + over() * bh)]:
        n = 12  # a wobbly pencil line
        xs = np.linspace(x1, x2, n) + [rng.uniform(-2, 2) for _ in range(n)]
        ys = np.linspace(y1, y2, n) + [rng.uniform(-2, 2) for _ in range(n)]
        cv2.polylines(image, [np.int32(np.stack([xs, ys], 1))], False, (55, 50, 50), rng.choice(widths), cv2.LINE_AA)
cv2.imwrite(args.out, image, [cv2.IMWRITE_JPEG_QUALITY, 85])
