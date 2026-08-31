import json
import logging
from pathlib import Path

from models.math_concept import MathConcept

logger = logging.getLogger(__name__)

CONCEPTS_PATH = Path(__file__).parent / "data" / "concepts.json"


class ConceptStore:
    """Loads math concept schemas from a local JSON file."""

    def __init__(self, path: Path | None = None):
        self.path = path or CONCEPTS_PATH
        self._by_id: dict[str, MathConcept] = {}
        self.reload()

    def reload(self) -> None:
        self._by_id.clear()
        if not self.path.exists():
            logger.warning("Concepts file missing: %s", self.path)
            return

        with self.path.open(encoding="utf-8") as handle:
            data = json.load(handle)

        if not isinstance(data, list):
            raise ValueError(f"{self.path} must contain a JSON array of concepts")

        for item in data:
            concept = MathConcept.model_validate(item)
            if concept.concept_id in self._by_id:
                raise ValueError(f"Duplicate concept_id: {concept.concept_id}")
            self._by_id[concept.concept_id] = concept

        self._warn_missing_links()
        logger.info("Loaded %s math concepts from %s", len(self._by_id), self.path)

    def _warn_missing_links(self) -> None:
        for concept in self._by_id.values():
            for field in ("prerequisites", "related_concepts"):
                for linked_id in getattr(concept, field):
                    if linked_id not in self._by_id:
                        logger.warning(
                            "Concept '%s' %s references unknown concept_id '%s'",
                            concept.concept_id,
                            field,
                            linked_id,
                        )

    def get(self, concept_id: str) -> MathConcept | None:
        return self._by_id.get(concept_id)

    def all(self) -> list[MathConcept]:
        return list(self._by_id.values())

    def __len__(self) -> int:
        return len(self._by_id)


concept_store = ConceptStore()
