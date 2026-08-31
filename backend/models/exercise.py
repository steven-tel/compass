from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.math_concept import _require_slug


class ExerciseOutcome(str, Enum):
    completed_correct = "completed_correct"
    completed_incorrect = "completed_incorrect"
    abandoned = "abandoned"
    completed_with_help = "completed_with_help"


class HintTrigger(str, Enum):
    student_asked = "student_asked"
    tutor_offered = "tutor_offered"


class ConfidenceLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Hint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hint_level: int = Field(ge=1, description="How far the tutor went on the hint ladder")
    text: str
    timestamp: datetime
    triggered_by: HintTrigger = Field(
        description="student_asked | tutor_offered (student was silent/stuck too long)"
    )


class StuckPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step_description: str
    related_concept_id: str
    observed_behavior: str

    @field_validator("related_concept_id")
    @classmethod
    def related_concept_id_is_slug(cls, value: str) -> str:
        return _require_slug(value)


class ExerciseError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str
    related_concept_id: str
    matched_common_mistake: bool = Field(
        description="Whether this matches the exercise's common_mistakes list"
    )
    self_corrected: bool = Field(
        description="True if the student caught it themselves, false if they needed a hint"
    )

    @field_validator("related_concept_id")
    @classmethod
    def related_concept_id_is_slug(cls, value: str) -> str:
        return _require_slug(value)


class ConfidenceAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: ConfidenceLevel = Field(description="Tutor's inferred read: low | medium | high")
    reasoning: str


class Exercise(BaseModel):
    """A student's attempt at an exercise during a homework session."""

    model_config = ConfigDict(extra="forbid")

    exercise_id: str
    student_id: str
    session_id: str
    concept_ids: list[str] = Field(
        description=(
            "Usually copied from the exercise; may differ if the tutor sees the student "
            "leaning on a different skill than expected"
        )
    )

    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: int | None = Field(default=None, ge=0)

    outcome: ExerciseOutcome

    hints_given: list[Hint] = Field(default_factory=list)
    stuck_points: list[StuckPoint] = Field(default_factory=list)
    errors: list[ExerciseError] = Field(default_factory=list)

    confidence_assessment: ConfidenceAssessment | None = None
    independence_score: float | None = Field(
        default=None,
        ge=0,
        le=1,
        description="0-1; fewer hints, fewer errors, and faster first move raise the score",
    )

    final_answer_given: str | None = None
    correct: bool | None = None
    tutor_notes: str | None = None

    @field_validator("concept_ids")
    @classmethod
    def concept_ids_are_slugs(cls, values: list[str]) -> list[str]:
        return [_require_slug(item) for item in values]

    @model_validator(mode="after")
    def ended_at_is_after_started_at(self) -> "Exercise":
        if self.ended_at is not None and self.ended_at < self.started_at:
            raise ValueError("ended_at must be at or after started_at")
        return self
