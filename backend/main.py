import asyncio
import base64
import json
import logging
import os
from pathlib import Path

os.environ.setdefault("GRPC_ENABLE_FORK_SUPPORT", "0")

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from db import (
    HomeworkSessionRecorder,
    delete_homework_session,
    get_evaluated_concept,
    get_homework_session,
    get_session_exercise,
    get_tutor_tips,
    list_evaluated_concepts,
    list_homework_sessions,
    list_session_exercises,
    set_session_analysis_status,
)
from gemini_live import GeminiLive
from models.homework_session import SessionStatus
from twilio_handler import TwilioHandler

_APP_DIR = Path(__file__).resolve().parent
_STATIC_DIR = _APP_DIR / "static"
load_dotenv(_APP_DIR / ".env")

# Configure logging - DEBUG for our modules, INFO for everything else
logging.basicConfig(level=logging.INFO)
logging.getLogger("gemini_live").setLevel(logging.DEBUG)
logging.getLogger(__name__).setLevel(logging.DEBUG)
logger = logging.getLogger(__name__)


def _is_client_disconnect(error: BaseException) -> bool:
    if isinstance(error, WebSocketDisconnect):
        return True
    message = str(error).lower()
    return "disconnect" in message or "clientdisconnected" in type(error).__name__.lower()


# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("MODEL", "gemini-3.1-flash-live-preview")

# Twilio config (optional — only needed for phone call integration)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_APP_HOST = os.getenv("TWILIO_APP_HOST")

# Initialize FastAPI
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def media_permissions_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Permissions-Policy"] = (
        "camera=(self), microphone=(self), display-capture=(self)"
    )
    return response


app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


def _page(name: str) -> FileResponse:
    return FileResponse(_STATIC_DIR / name)


@app.get("/")
async def root():
    return _page("index.html")


@app.get("/sessions")
async def sessions_page():
    return _page("sessions.html")


@app.get("/concepts")
async def concepts_page():
    return _page("concepts.html")


@app.get("/concepts/{concept_id}")
async def concept_detail_page(concept_id: str):
    return _page("concept-detail.html")


@app.get("/sessions/{session_id}/exercises/{exercise_id}")
async def exercise_detail_page(session_id: str, exercise_id: str):
    return _page("exercise-detail.html")


@app.get("/sessions/{session_id}")
async def session_detail_page(session_id: str):
    return _page("session-detail.html")


@app.get("/api/sessions")
async def api_list_sessions():
    try:
        sessions = await asyncio.to_thread(list_homework_sessions)
    except Exception as error:
        logger.exception("Failed to list homework sessions")
        raise HTTPException(status_code=500, detail=str(error)) from error
    return {"sessions": sessions}


@app.get("/api/sessions/{session_id}")
async def api_get_session(session_id: str):
    session = await asyncio.to_thread(get_homework_session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown session_id: {session_id}")
    return session


@app.get("/api/sessions/{session_id}/exercises")
async def api_list_session_exercises(session_id: str):
    session = await asyncio.to_thread(get_homework_session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown session_id: {session_id}")
    exercises = await asyncio.to_thread(list_session_exercises, session_id)
    return {"session_id": session_id, "exercises": exercises}


@app.get("/api/sessions/{session_id}/exercises/{exercise_id}")
async def api_get_session_exercise(session_id: str, exercise_id: str):
    session = await asyncio.to_thread(get_homework_session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown session_id: {session_id}")
    exercise = await asyncio.to_thread(get_session_exercise, session_id, exercise_id)
    if exercise is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown exercise_id: {exercise_id}",
        )
    return exercise


@app.post("/api/sessions/{session_id}/exercises/detect")
async def api_detect_session_exercises(session_id: str):
    session = await asyncio.to_thread(get_homework_session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown session_id: {session_id}")
    from exercise_detector import detect_exercises_for_session

    try:
        exercises = await asyncio.to_thread(
            detect_exercises_for_session, session_id, write=True
        )
    except Exception as error:
        logger.exception("Exercise detection failed for session %s", session_id)
        raise HTTPException(status_code=500, detail=str(error)) from error
    try:
        from tutor_coach import refresh_after_session

        await asyncio.to_thread(refresh_after_session, session_id, exercises)
    except Exception:
        logger.exception("Tutor tips refresh failed for session %s", session_id)
    await asyncio.to_thread(set_session_analysis_status, session_id, "complete")
    return {
        "session_id": session_id,
        "exercises": [exercise.model_dump(mode="json") for exercise in exercises],
    }


@app.delete("/api/sessions/{session_id}")
async def api_delete_session(session_id: str):
    deleted = await asyncio.to_thread(delete_homework_session, session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown session_id: {session_id}")
    return {"deleted": session_id}


@app.get("/api/tutor-tips")
async def api_get_tutor_tips():
    try:
        from tutor_coach import get_or_refresh_tutor_tips

        tips = await asyncio.to_thread(get_or_refresh_tutor_tips)
        if tips and (tips.get("tips") or []):
            return tips
        if tips:
            stored = await asyncio.to_thread(get_tutor_tips)
            if stored and (stored.get("tips") or []):
                return stored
            return tips
    except Exception:
        logger.exception("Failed to load tutor tips")
    try:
        stored = await asyncio.to_thread(get_tutor_tips)
        if stored:
            return stored
    except Exception:
        logger.exception("Failed to read stored tutor tips")
    return {"headline": "", "tips": [], "next_focus": "", "session_count": 0}


@app.get("/api/concepts")
async def api_list_evaluated_concepts():
    try:
        concepts = await asyncio.to_thread(list_evaluated_concepts)
    except Exception as error:
        logger.exception("Failed to list evaluated concepts")
        raise HTTPException(status_code=500, detail=str(error)) from error
    return {"concepts": concepts}


@app.get("/api/concepts/{concept_id}")
async def api_get_evaluated_concept(concept_id: str):
    try:
        concept = await asyncio.to_thread(get_evaluated_concept, concept_id)
    except Exception as error:
        logger.exception("Failed to load concept %s", concept_id)
        raise HTTPException(status_code=500, detail=str(error)) from error
    if concept is None:
        raise HTTPException(status_code=404, detail=f"Unknown concept_id: {concept_id}")
    return concept


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for Gemini Live."""
    await websocket.accept()

    logger.info("WebSocket connection accepted")

    recorder = HomeworkSessionRecorder()
    session_status = SessionStatus.completed
    discard_session = False
    try:
        await websocket.send_json(
            {"type": "session_start", "session_id": recorder.session.session_id}
        )
    except Exception:
        logger.warning("Could not send session_start to client")

    audio_input_queue = asyncio.Queue()
    video_input_queue = asyncio.Queue()
    text_input_queue = asyncio.Queue()

    async def audio_output_callback(data):
        try:
            await websocket.send_bytes(data)
        except WebSocketDisconnect:
            logger.info("Client disconnected while sending audio")
        except Exception as e:
            if _is_client_disconnect(e):
                logger.info("Client disconnected while sending audio")
                return
            raise

    async def audio_interrupt_callback():
        # The event queue handles the JSON message, but we might want to do something else here
        pass

    gemini_client = GeminiLive(
        api_key=GEMINI_API_KEY, model=MODEL, input_sample_rate=16000
    )

    async def receive_from_client():
        nonlocal discard_session
        try:
            while True:
                message = await websocket.receive()

                if message.get("bytes"):
                    await audio_input_queue.put(message["bytes"])
                elif message.get("text"):
                    text = message["text"]
                    try:
                        payload = json.loads(text)
                        if isinstance(payload, dict):
                            if payload.get("type") == "cancel_session":
                                discard_session = True
                                logger.info(
                                    "Client cancelled homework session %s",
                                    recorder.session.session_id,
                                )
                                return
                            if payload.get("type") == "image":
                                logger.info(f"Received image chunk from client: {len(payload['data'])} base64 chars")
                                image_data = base64.b64decode(payload["data"])
                                await video_input_queue.put(image_data)
                                continue
                            if isinstance(payload.get("text"), str):
                                text = payload["text"]
                    except json.JSONDecodeError:
                        pass

                    await text_input_queue.put(text)
                    recorder.record_typed_user(text)
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except Exception as e:
            if _is_client_disconnect(e):
                logger.info("WebSocket disconnected")
            else:
                logger.error(f"Error receiving from client: {e}")

    async def run_session():
        async for event in gemini_client.start_session(
            audio_input_queue=audio_input_queue,
            video_input_queue=video_input_queue,
            text_input_queue=text_input_queue,
            audio_output_callback=audio_output_callback,
            audio_interrupt_callback=audio_interrupt_callback,
        ):
            if event:
                recorder.record_event(event)
                if event.get("type") == "session_end":
                    event = {**event, "session_id": recorder.session.session_id}
                try:
                    await websocket.send_json(event)
                except WebSocketDisconnect:
                    logger.info("Client disconnected while sending event")
                    return
                except Exception as e:
                    if _is_client_disconnect(e):
                        logger.info("Client disconnected while sending event")
                        return
                    raise
                if event.get("type") == "session_end":
                    logger.info("Student ended the session; saving after goodbye")
                    return

    receive_task = asyncio.create_task(receive_from_client())
    session_task = asyncio.create_task(run_session())

    try:
        done, pending = await asyncio.wait(
            {receive_task, session_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            if task.cancelled():
                continue
            exc = task.exception()
            if exc is None:
                continue
            if _is_client_disconnect(exc):
                logger.info("WebSocket disconnected after a clean session end")
            else:
                session_status = SessionStatus.error
                logger.error(
                    "Error in Gemini session: %s: %s",
                    type(exc).__name__,
                    exc,
                    exc_info=exc,
                )
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected after a clean session end")
    except Exception as e:
        import traceback
        if _is_client_disconnect(e):
            logger.info("WebSocket disconnected after a clean session end")
        else:
            session_status = SessionStatus.error
            logger.error(f"Error in Gemini session: {type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        receive_task.cancel()
        session_task.cancel()
        try:
            if discard_session:
                logger.info(
                    "Discarding cancelled homework session %s",
                    recorder.session.session_id,
                )
                await asyncio.to_thread(
                    delete_homework_session, recorder.session.session_id
                )
            else:
                logger.info("Saving homework session %s", recorder.session.session_id)
                saved = await asyncio.to_thread(recorder.finish, session_status)
                if saved.raw_transcript_ref:
                    from exercise_detector import run_post_session_detection

                    await asyncio.to_thread(run_post_session_detection, saved.session_id)
                else:
                    await asyncio.to_thread(
                        set_session_analysis_status, saved.session_id, "complete"
                    )
        except Exception as save_error:
            logger.error(
                "Failed to save homework session %s: %s",
                recorder.session.session_id,
                save_error,
                exc_info=True,
            )
        # Ensure websocket is closed if not already
        try:
            await websocket.close()
        except:
            pass


# ─── Twilio Endpoints ─────────────────────────────────────────────────────────

@app.post("/twilio/inbound")
async def twilio_inbound():
    """Handles inbound Twilio calls. Returns TwiML to open a media stream."""
    host = TWILIO_APP_HOST or "localhost:8000"
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting to Gemini Live.</Say>
    <Connect>
        <Stream url="wss://{host}/twilio/stream" />
    </Connect>
</Response>"""
    return Response(content=twiml, media_type="application/xml")


@app.post("/twilio/outbound")
async def twilio_outbound(
    to_number: str = Query(..., description="Destination phone number (E.164 format)"),
    from_number: str = Query(..., description="Your Twilio phone number (E.164 format)"),
):
    """Initiates an outbound Twilio call that connects to Gemini Live."""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        return {"error": "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in environment"}
    if not TWILIO_APP_HOST:
        return {"error": "TWILIO_APP_HOST must be set in environment"}

    from twilio.rest import Client as TwilioClient

    client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    twiml = f"""<Response>
    <Say>Connecting to Gemini Live.</Say>
    <Connect>
        <Stream url="wss://{TWILIO_APP_HOST}/twilio/stream" />
    </Connect>
</Response>"""

    call = client.calls.create(
        to=to_number,
        from_=from_number,
        twiml=twiml,
    )
    logger.info(f"Outbound call initiated: {call.sid}")
    return {"callSid": call.sid, "status": call.status}


@app.websocket("/twilio/stream")
async def twilio_stream(websocket: WebSocket):
    """WebSocket endpoint for Twilio Media Streams."""
    await websocket.accept()
    logger.info("Twilio media stream WebSocket connected")

    handler = TwilioHandler(gemini_api_key=GEMINI_API_KEY, model=MODEL)
    try:
        await handler.handle_media_stream(websocket)
    except Exception as e:
        logger.error(f"Twilio stream error: {e}", exc_info=True)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("Twilio media stream WebSocket closed")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
