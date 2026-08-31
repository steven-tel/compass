import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from db import DATABASE, PROJECT, get_db
from models.math_concept import MathConcept

CONCEPTS_PATH = Path(__file__).resolve().parent / "concepts.json"
COLLECTION = "concepts"


def main() -> None:
    raw = json.loads(CONCEPTS_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"{CONCEPTS_PATH} must contain a JSON array of concepts")

    db = get_db()
    batch = db.batch()

    concepts: list[MathConcept] = []
    for item in raw:
        concept = MathConcept.model_validate(item)
        ref = db.collection(COLLECTION).document(concept.concept_id)
        batch.set(ref, concept.model_dump())
        concepts.append(concept)

    batch.commit()
    print(f"Wrote {len(concepts)} concepts to {PROJECT}/{DATABASE}/{COLLECTION}")
    for concept in concepts:
        print(f"  {concept.concept_id}")


if __name__ == "__main__":
    main()
