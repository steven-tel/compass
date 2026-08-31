"""Seed three recent homework sessions (last 3 days) with camera observations."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from db import (
    _to_firestore,
    get_db,
    link_exercises_to_session,
    save_homework_session,
    save_session_exercise,
    set_session_analysis_status,
)
from models.exercise import (
    ConfidenceAssessment,
    Exercise,
    ExerciseError,
    ExerciseOutcome,
    Hint,
    HintTrigger,
    StuckPoint,
)
from models.homework_session import (
    DeviceInfo,
    HomeworkSession,
    OverallEngagement,
    SessionStatus,
    TranscriptMessage,
)

ICT = timezone(timedelta(hours=7))
STUDENT = "student_steven"


def at(day: int, hour: int, minute: int, second: int = 0) -> datetime:
    return datetime(2026, 8, day, hour, minute, second, tzinfo=ICT).astimezone(timezone.utc)


def turn(when: datetime, role: str, text: str, kind: str | None = None) -> TranscriptMessage:
    return TranscriptMessage(role=role, text=text, timestamp=when, kind=kind)


def hint(when: datetime, level: int, text: str, asked: bool = False) -> Hint:
    return Hint(
        hint_level=level,
        text=text,
        timestamp=when,
        triggered_by=HintTrigger.student_asked if asked else HintTrigger.tutor_offered,
    )


def write_session(session: HomeworkSession, exercises: list[tuple[Exercise, str]]) -> None:
    save_homework_session(session)
    saved: list[Exercise] = []
    for exercise, title in exercises:
        save_session_exercise(session.session_id, exercise)
        get_db().collection("homework_sessions").document(session.session_id).collection(
            "exercises"
        ).document(exercise.exercise_id).update(_to_firestore({"title": title}))
        saved.append(exercise)
    link_exercises_to_session(session.session_id, saved)
    set_session_analysis_status(session.session_id, "complete")
    print(f"wrote {session.session_id}  {session.title}  {session.duration_seconds}s  {len(saved)} exercises")


def session_saturday() -> None:
    sid = "sess_sim_0829_derivatives"
    start = at(29, 19, 20)
    end = at(29, 20, 12)
    t = lambda h, m, s=0: at(29, h, m, s)

    transcript = [
        turn(t(19, 20, 12), "agent", "Ready when you are. What's the first problem?"),
        turn(t(19, 20, 40), "user", "Differentiate x cubed plus 4x."),
        turn(t(19, 21, 8), "observation", "Wrote $x^3+4x$ clearly, pencil already moving on the first term.", "progress"),
        turn(t(19, 21, 40), "user", "3x squared plus 4."),
        turn(t(19, 22, 2), "observation", "Underlined the 4 and left it as 4. No extra marks.", "success"),
        turn(t(19, 22, 20), "agent", "Nice. Power rule is clean. Next one?"),
        turn(t(19, 24, 10), "user", "Product rule. f is x squared, g is e to the x."),
        turn(t(19, 25, 5), "observation", "Wrote $2x\\cdot e^x$ then stopped, hovering over whether to add another term.", "pause"),
        turn(t(19, 26, 0), "agent", "Product rule is $u'v+uv'$. You've got the first half."),
        turn(t(19, 26, 40), "user", "So plus x squared e to the x."),
        turn(t(19, 27, 10), "observation", "Added $x^2 e^x$ and boxed $e^x(2x+x^2)$.", "success"),
        turn(t(19, 28, 0), "agent", "You can factor $e^x$ if you want. Last one is chain rule."),
        turn(t(19, 32, 20), "user", "sin of 3x."),
        turn(t(19, 33, 0), "observation", "Wrote $\\cos(3x)$ only. Inner 3 not brought out yet.", "mistake"),
        turn(t(19, 33, 40), "agent", "What's the inside function doing?"),
        turn(t(19, 34, 20), "user", "Oh, times 3. 3 cos 3x."),
        turn(t(19, 34, 50), "observation", "Scribbled a 3 in front and nodded at the page.", "correction"),
        turn(t(19, 48, 10), "user", "One more: e to the 2x."),
        turn(t(19, 49, 0), "observation", "Wrote $2e^{2x}$ in one pass, no pause.", "progress"),
        turn(t(19, 50, 20), "agent", "That's the chain rule. Solid set tonight."),
        turn(t(20, 11, 40), "user", "Okay I'm done."),
    ]

    exercises = [
        (
            Exercise(
                exercise_id=f"{sid}_ex01",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["derivative_rules"],
                started_at=t(19, 20, 40),
                ended_at=t(19, 23, 20),
                duration_seconds=160,
                outcome=ExerciseOutcome.completed_correct,
                independence_score=0.94,
                correct=True,
                final_answer_given=r"$3x^2+4$",
                confidence_assessment=ConfidenceAssessment(
                    level="high", reasoning="Wrote the power rule in one pass with no hint."
                ),
                tutor_notes="Camera saw a clean first line. Power rule is automatic.",
            ),
            r"Differentiate $x^3+4x$",
        ),
        (
            Exercise(
                exercise_id=f"{sid}_ex02",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["derivative_rules", "derivative_trig_exp_log"],
                started_at=t(19, 24, 10),
                ended_at=t(19, 31, 0),
                duration_seconds=410,
                outcome=ExerciseOutcome.completed_with_help,
                independence_score=0.62,
                correct=True,
                final_answer_given=r"$e^x(2x+x^2)$",
                hints_given=[
                    hint(t(19, 26, 0), 1, r"Product rule is $u'v+uv'$. You've got the first half."),
                ],
                stuck_points=[
                    StuckPoint(
                        step_description=r"Second term of $(x^2 e^x)'$",
                        related_concept_id="derivative_rules",
                        observed_behavior="Pencil hovered after $2x e^x$; inner $u v'$ missing.",
                    )
                ],
                errors=[
                    ExerciseError(
                        description="Stopped after the $u'v$ term",
                        related_concept_id="derivative_rules",
                        matched_common_mistake=True,
                        self_corrected=False,
                    )
                ],
                confidence_assessment=ConfidenceAssessment(
                    level="medium", reasoning="Needed a nudge for the second product term."
                ),
                tutor_notes="Paused on the page after the first term. Finished cleanly once prompted.",
            ),
            r"Differentiate $x^2 e^x$",
        ),
        (
            Exercise(
                exercise_id=f"{sid}_ex03",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["derivative_rules", "derivative_trig_exp_log"],
                started_at=t(19, 32, 20),
                ended_at=t(20, 11, 40),
                duration_seconds=2360,
                outcome=ExerciseOutcome.completed_correct,
                independence_score=0.78,
                correct=True,
                final_answer_given=r"$3\cos(3x)$, then $2e^{2x}$",
                errors=[
                    ExerciseError(
                        description="Forgot to multiply by the inner derivative of $3x$",
                        related_concept_id="derivative_rules",
                        matched_common_mistake=True,
                        self_corrected=True,
                    )
                ],
                confidence_assessment=ConfidenceAssessment(
                    level="medium",
                    reasoning="Caught the missing factor 3 after a short prompt; $e^{2x}$ was fluent.",
                ),
                tutor_notes="Camera caught $\\cos(3x)$ first, then a 3 added in front. Self-corrected.",
            ),
            r"Chain rule on $\sin(3x)$ and $e^{2x}$",
        ),
    ]

    write_session(
        HomeworkSession(
            session_id=sid,
            title="Power, product, and chain rule",
            started_at=start,
            ended_at=end,
            duration_seconds=int((end - start).total_seconds()),
            status=SessionStatus.completed,
            course_focus="calculus",
            exercise_id=[ex.exercise_id for ex, _ in exercises],
            exercise_count=3,
            completed_count=3,
            abandoned_count=0,
            concepts_covered=["derivative_rules", "derivative_trig_exp_log"],
            concepts_struggled=["derivative_rules"],
            overall_engagement=OverallEngagement(
                level="high",
                reasoning="Stayed on the page for the full hour; only one long pause on product rule.",
            ),
            session_summary="Power rule was automatic. Product rule needed a nudge for the second term. Chain rule: forgot the inner 3 at first, then fixed it on the paper.",
            analysis_status="complete",
            recommended_next_concepts=["implicit_differentiation", "applications_derivatives"],
            raw_transcript_ref=transcript,
            device_info=DeviceInfo(app_version="sim-seed", camera_angle_ok=True),
        ),
        exercises,
    )


def session_sunday() -> None:
    sid = "sess_sim_0830_trig"
    start = at(30, 16, 40)
    end = at(30, 17, 41)
    t = lambda h, m, s=0: at(30, h, m, s)

    transcript = [
        turn(t(16, 40, 8), "agent", "Trig night. Start with the unit circle."),
        turn(t(16, 40, 40), "user", "What's cosine of 2 pi over 3."),
        turn(t(16, 41, 20), "observation", "Sketched a circle, marked the 60° line, then the 120° ray.", "progress"),
        turn(t(16, 42, 10), "user", "It's negative one half. x is negative in quadrant two."),
        turn(t(16, 42, 40), "observation", "Wrote $-1/2$ and double-checked the sign with a small arrow on the x-axis.", "success"),
        turn(t(16, 43, 10), "agent", "Good. Sine of that angle?"),
        turn(t(16, 43, 40), "user", "Root 3 over 2."),
        turn(t(16, 48, 0), "user", "Now graph y equals sin of x minus pi over 2."),
        turn(t(16, 49, 20), "observation", "Drew a regular sine wave first, then erased the first hump.", "struggle"),
        turn(t(16, 50, 40), "agent", "A shift of $\\pi/2$ to the right. Where is the zero now?"),
        turn(t(16, 51, 30), "user", "Zero at pi over 2. It's like cosine, actually."),
        turn(t(16, 52, 0), "observation", "Redrew the wave starting at a peak on the y-axis, labeled $\\cos x$.", "correction"),
        turn(t(16, 58, 20), "user", "Prove sin squared plus cos squared is 1 for 5 pi over 6."),
        turn(t(16, 59, 10), "observation", "Wrote $(\\frac12)^2+(\\frac{\\sqrt3}{2})^2$ then paused on the sine value.", "pause"),
        turn(t(17, 0, 20), "user", "Wait sine of 5 pi over 6 is one half, cosine is negative root 3 over 2. 1/4 plus 3/4 is 1."),
        turn(t(17, 0, 50), "observation", "Corrected the cosine sign and boxed 1.", "success"),
        turn(t(17, 8, 0), "user", "Double angle. sin of 2 theta if theta is pi over 12."),
        turn(t(17, 9, 10), "observation", "Wrote $2\\sin\\theta\\cos\\theta$ then plugged $\\pi/12$ without reducing to $\\pi/6$.", "progress"),
        turn(t(17, 11, 0), "agent", "You already know $\\sin(\\pi/6)$. That's $\\sin(2\\cdot\\pi/12)$."),
        turn(t(17, 12, 20), "user", "Oh it's just one half. I overcomplicated it."),
        turn(t(17, 12, 50), "observation", "Crossed out a long radical and wrote $1/2$.", "correction"),
        turn(t(17, 40, 30), "agent", "Nice recovery on the double angle. Unit circle is in good shape."),
        turn(t(17, 41, 0), "user", "Thanks, stopping here."),
    ]

    exercises = [
        (
            Exercise(
                exercise_id=f"{sid}_ex01",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["trig_unit_circle"],
                started_at=t(16, 40, 40),
                ended_at=t(16, 47, 20),
                duration_seconds=400,
                outcome=ExerciseOutcome.completed_correct,
                independence_score=0.91,
                correct=True,
                final_answer_given=r"$\cos(2\pi/3)=-1/2$, $\sin=\sqrt{3}/2$",
                confidence_assessment=ConfidenceAssessment(
                    level="high", reasoning="Drew the circle and used quadrant signs without a hint."
                ),
                tutor_notes="Camera saw a proper unit-circle sketch and a sign check on the x-axis.",
            ),
            r"$\cos(2\pi/3)$ and $\sin(2\pi/3)$",
        ),
        (
            Exercise(
                exercise_id=f"{sid}_ex02",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["trig_functions_graphing"],
                started_at=t(16, 48, 0),
                ended_at=t(16, 57, 40),
                duration_seconds=580,
                outcome=ExerciseOutcome.completed_with_help,
                independence_score=0.55,
                correct=True,
                final_answer_given=r"$y=\sin(x-\pi/2)$ matches $\cos x$",
                hints_given=[
                    hint(t(16, 50, 40), 1, r"A shift of $\pi/2$ to the right. Where is the zero now?"),
                ],
                stuck_points=[
                    StuckPoint(
                        step_description="Graphing the phase shift",
                        related_concept_id="trig_functions_graphing",
                        observed_behavior="Drew an unshifted sine, then erased the first hump.",
                    )
                ],
                confidence_assessment=ConfidenceAssessment(
                    level="medium", reasoning="Needed the shift prompt; then connected it to cosine."
                ),
                tutor_notes="Visible erase of the first sine wave, then a cosine-shaped redraw.",
            ),
            r"Graph $y=\sin(x-\pi/2)$",
        ),
        (
            Exercise(
                exercise_id=f"{sid}_ex03",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["trig_identities", "trig_unit_circle"],
                started_at=t(16, 58, 20),
                ended_at=t(17, 7, 20),
                duration_seconds=540,
                outcome=ExerciseOutcome.completed_correct,
                independence_score=0.84,
                correct=True,
                final_answer_given=r"$\sin^2+\cos^2=1$ at $5\pi/6$",
                errors=[
                    ExerciseError(
                        description=r"Swapped sine/cosine values for $5\pi/6$ at first",
                        related_concept_id="trig_unit_circle",
                        matched_common_mistake=True,
                        self_corrected=True,
                    )
                ],
                confidence_assessment=ConfidenceAssessment(
                    level="high", reasoning="Paused, then fixed the values and finished the identity."
                ),
                tutor_notes="Short pause on the sine value, then a clean 1/4+3/4.",
            ),
            r"Check $\sin^2\\theta+\\cos^2\\theta$ at $5\pi/6$",
        ),
        (
            Exercise(
                exercise_id=f"{sid}_ex04",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["trig_identities"],
                started_at=t(17, 8, 0),
                ended_at=t(17, 41, 0),
                duration_seconds=1980,
                outcome=ExerciseOutcome.completed_with_help,
                independence_score=0.48,
                correct=True,
                final_answer_given=r"$\sin(\pi/6)=1/2$",
                hints_given=[
                    hint(t(17, 11, 0), 1, r"You already know $\sin(\pi/6)$. That's $\sin(2\cdot\pi/12)$."),
                ],
                stuck_points=[
                    StuckPoint(
                        step_description=r"Evaluating $\sin(2\cdot\pi/12)$",
                        related_concept_id="trig_identities",
                        observed_behavior=r"Expanded $2\sin\theta\cos\theta$ with $\pi/12$ instead of reducing.",
                    )
                ],
                confidence_assessment=ConfidenceAssessment(
                    level="low", reasoning="Knew the formula but missed the simpler angle."
                ),
                tutor_notes="Long expansion on paper, then crossed out and wrote 1/2.",
            ),
            r"$\sin(2\pi/12)$ via double angle",
        ),
    ]

    write_session(
        HomeworkSession(
            session_id=sid,
            title="Unit circle and identities",
            started_at=start,
            ended_at=end,
            duration_seconds=int((end - start).total_seconds()),
            status=SessionStatus.completed,
            course_focus="precalculus",
            exercise_id=[ex.exercise_id for ex, _ in exercises],
            exercise_count=4,
            completed_count=4,
            abandoned_count=0,
            concepts_covered=["trig_unit_circle", "trig_functions_graphing", "trig_identities"],
            concepts_struggled=["trig_identities", "trig_functions_graphing"],
            overall_engagement=OverallEngagement(
                level="medium",
                reasoning="Energetic on the circle, slower on the graph and double angle.",
            ),
            session_summary="Unit circle values were confident. The sine shift needed a redraw. Double-angle was over-expanded until the $\\pi/6$ hint.",
            analysis_status="complete",
            recommended_next_concepts=["trig_identities", "trig_functions_graphing"],
            raw_transcript_ref=transcript,
            device_info=DeviceInfo(app_version="sim-seed", camera_angle_ok=True),
        ),
        exercises,
    )


def session_monday() -> None:
    sid = "sess_sim_0831_integrals"
    start = at(31, 15, 20)
    end = at(31, 16, 4)
    t = lambda h, m, s=0: at(31, h, m, s)

    transcript = [
        turn(t(15, 20, 10), "agent", "Integrals. First antiderivative."),
        turn(t(15, 20, 40), "user", "Integral of 6x squared."),
        turn(t(15, 21, 10), "observation", "Wrote $6\\cdot x^3/3$ immediately, then simplified to $2x^3+C$.", "success"),
        turn(t(15, 21, 40), "user", "2x cubed plus C."),
        turn(t(15, 22, 0), "agent", "Good. Next is a u-sub."),
        turn(t(15, 26, 10), "user", "Integral of 2x times e to the x squared."),
        turn(t(15, 27, 0), "observation", "Set $u=x^2$ in the margin, then wrote $du=2x\\,dx$. Lined it up with the integrand.", "progress"),
        turn(t(15, 28, 20), "user", "So it's just e to the u, that's e to the x squared plus C."),
        turn(t(15, 28, 50), "observation", "Boxed $e^{x^2}+C$ without extra terms.", "success"),
        turn(t(15, 29, 20), "agent", "That's the one. Last: definite integral from 0 to 2 of x dx."),
        turn(t(15, 34, 0), "user", "Antiderivative is x squared over 2. From 0 to 2 is 2."),
        turn(t(15, 34, 40), "observation", "Evaluated $4/2-0$ and wrote 2. Then stared at it and added a question mark.", "pause"),
        turn(t(15, 35, 20), "agent", "F(2) minus F(0). You're good — that's 2."),
        turn(t(15, 35, 50), "observation", "Crossed out the question mark.", "correction"),
        turn(t(15, 48, 10), "user", "Can I do one more, 1 over x from 1 to e?"),
        turn(t(15, 49, 0), "observation", "Wrote $\\ln|x|$ then $\\ln e-\\ln 1$.", "progress"),
        turn(t(15, 50, 20), "user", "That's 1 minus 0, so 1."),
        turn(t(15, 50, 50), "observation", "No extra algebra. Clean ln evaluation.", "success"),
        turn(t(16, 3, 20), "agent", "Clean hour. u-sub is the keeper."),
        turn(t(16, 3, 50), "user", "Cool. Closing."),
    ]

    exercises = [
        (
            Exercise(
                exercise_id=f"{sid}_ex01",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["antiderivatives"],
                started_at=t(15, 20, 40),
                ended_at=t(15, 25, 40),
                duration_seconds=300,
                outcome=ExerciseOutcome.completed_correct,
                independence_score=0.96,
                correct=True,
                final_answer_given=r"$2x^3+C$",
                confidence_assessment=ConfidenceAssessment(
                    level="high", reasoning="Reversed the power rule with the +C without prompting."
                ),
                tutor_notes="Wrote $6x^3/3$ then simplified in one line.",
            ),
            r"$\int 6x^2\\,dx$",
        ),
        (
            Exercise(
                exercise_id=f"{sid}_ex02",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["integration_techniques", "antiderivatives"],
                started_at=t(15, 26, 10),
                ended_at=t(15, 33, 20),
                duration_seconds=430,
                outcome=ExerciseOutcome.completed_correct,
                independence_score=0.88,
                correct=True,
                final_answer_given=r"$e^{x^2}+C$",
                confidence_assessment=ConfidenceAssessment(
                    level="high", reasoning="Chose $u=x^2$ and matched $du$ to the 2x factor unaided."
                ),
                tutor_notes="Margin showed $u=x^2$, $du=2x\\,dx$ aligned with the integrand.",
            ),
            r"$\int 2x e^{x^2}\\,dx$",
        ),
        (
            Exercise(
                exercise_id=f"{sid}_ex03",
                student_id=STUDENT,
                session_id=sid,
                concept_ids=["definite_integrals", "antiderivatives"],
                started_at=t(15, 34, 0),
                ended_at=t(16, 3, 50),
                duration_seconds=1790,
                outcome=ExerciseOutcome.completed_correct,
                independence_score=0.81,
                correct=True,
                final_answer_given=r"$\int_0^2 x\\,dx=2$, $\int_1^e (1/x)\\,dx=1$",
                hints_given=[
                    hint(t(15, 35, 20), 1, "F(2) minus F(0). You're good — that's 2."),
                ],
                confidence_assessment=ConfidenceAssessment(
                    level="medium",
                    reasoning="Doubted a correct evaluation, then did the ln integral independently.",
                ),
                tutor_notes="Question mark next to a correct 2, then a clean $\\ln e-\\ln 1$.",
            ),
            r"Definite integrals $\int_0^2 x\\,dx$ and $\int_1^e \\frac{1}{x}\\,dx$",
        ),
    ]

    write_session(
        HomeworkSession(
            session_id=sid,
            title="Antiderivatives and u-substitution",
            started_at=start,
            ended_at=end,
            duration_seconds=int((end - start).total_seconds()),
            status=SessionStatus.completed,
            course_focus="calculus",
            exercise_id=[ex.exercise_id for ex, _ in exercises],
            exercise_count=3,
            completed_count=3,
            abandoned_count=0,
            concepts_covered=["antiderivatives", "integration_techniques", "definite_integrals"],
            concepts_struggled=["definite_integrals"],
            overall_engagement=OverallEngagement(
                level="high",
                reasoning="Moved quickly; only hesitated after a correct definite-integral evaluation.",
            ),
            session_summary="Power antiderivative and u-sub were fluent. A brief doubt on $\\int_0^2 x\\,dx$ even though 2 was right, then a clean $\\ln$ definite integral.",
            analysis_status="complete",
            recommended_next_concepts=["applications_integrals", "integration_techniques"],
            raw_transcript_ref=transcript,
            device_info=DeviceInfo(app_version="sim-seed", camera_angle_ok=True),
        ),
        exercises,
    )


if __name__ == "__main__":
    session_saturday()
    session_sunday()
    session_monday()
    print("done")
