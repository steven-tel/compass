from pydantic import BaseModel, ConfigDict, Field, field_validator


def _require_slug(value: str) -> str:
    slug = value.strip()
    if not slug or any(ch.isupper() or ch.isspace() for ch in slug):
        raise ValueError("must be a lowercase slug, e.g. fractions_equivalence")
    return slug


class MathConcept(BaseModel):
    """A node in the math concept map."""

    model_config = ConfigDict(extra="forbid")

    concept_id: str = Field(
        description="Stable slug ID, used everywhere else",
        examples=["fractions_equivalence"],
    )
    name: str = Field(description="Display name", examples=["Fractions équivalentes"])
    domain: str = Field(description="Top-level branch of math", examples=["arithmetic"])
    subdomain: str = Field(
        description="Narrower grouping within the domain",
        examples=["fractions"],
    )
    difficulty: int = Field(
        ge=1,
        le=5,
        description="1-5, relative to its own subdomain",
    )
    description: str = Field(description="What this concept covers")
    prerequisites: list[str] = Field(
        default_factory=list,
        description="concept_ids that should come before this one",
    )
    related_concepts: list[str] = Field(
        default_factory=list,
        description="Same-level, non-hierarchical links",
    )
    keywords: list[str] = Field(default_factory=list)

    @field_validator("concept_id")
    @classmethod
    def concept_id_is_slug(cls, value: str) -> str:
        return _require_slug(value)

    @field_validator("prerequisites", "related_concepts")
    @classmethod
    def link_ids_are_slugs(cls, values: list[str]) -> list[str]:
        return [_require_slug(item) for item in values]
