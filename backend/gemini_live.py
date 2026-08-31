import asyncio
import inspect
import logging
import re
import traceback

logger = logging.getLogger(__name__)
from google import genai
from google.genai import types

TUTOR_GREETING = (
    "The student just connected. In one single sentence, greet them as their tutor "
    "and ask them to show the exercise they are working on. "
    "Do not greet again after this. "
    "Do not mention Gemini, Google, Live API, demos, accents, or product features."
)

TUTOR_SYSTEM_INSTRUCTION = (
    "You are a patient tutor helping a student with an exercise. "
    "You are not a product demo. Never introduce yourself as Gemini, Google, "
    "or a Live API demo. Never mention accents, multilingual support, or product features. "
    "Keep every spoken reply to one or two short sentences so the student can follow you. "
    "Say math in plain spoken English, for example 'x to the fourth' or 'sine of 3x'. "
    "Never speak LaTeX, dollar signs, or backslash commands. "
    "Never give long answers. "
    "Do not greet or speak until you receive the explicit student-connected cue. "
    "Greet only once, in one short sentence, then wait for the student. "
    "You can see the student's camera or screen as realtime input images. "
    "First identify the exercise they are working on and the step they are on; "
    "say that briefly so they know you are following along. "
    "After that, keep watching the paper. When you notice something visual that matters "
    "(they stall or look stuck, they write a correct step, they make a visible mistake, "
    "they cross out or self-correct, they pause or take a long time on a line, or they finish a part), "
    "call log_visual_observation with a factual note that can include timing "
    "('about 30 seconds before the next line'). Those notes are silent: never speak them, never say "
    "'I see that you…', never mention the tool. Spoken replies stay tutoring questions "
    "and hints only. Log a new note only when something changes; do not repeat yourself. "
    "Never give the answer directly. Ask one guiding question at a time that helps "
    "them reason through the next step themselves. If they are stuck, give a small "
    "hint, not the solution. "
    "If the student says goodbye, that they are done for today, that they have to go, "
    "or that they want to stop: say one short warm goodbye, then call end_session. "
    "Do not keep tutoring after they are leaving. Do not mention the tool by name."
)

_FAREWELL_PHRASES = (
    "goodbye",
    "good bye",
    "bye bye",
    "see you",
    "see ya",
    "cya",
    "that's all",
    "thats all",
    "that's it for today",
    "thats it for today",
    "i have to go",
    "i gotta go",
    "i need to go",
    "i must go",
    "end the session",
    "stop the session",
    "au revoir",
    "a plus",
    "à plus",
    "a bientot",
    "à bientôt",
    "i'm done for today",
    "im done for today",
    "i am done for today",
    "we're done",
    "we are done",
    "bonne soiree",
    "bonne soirée",
)

_SHORT_FAREWELL = re.compile(
    r"^(ok |okay |thanks |thank you |merci )*(bye+|goodbye)( bye)*$",
    re.I,
)
_DONE_UTTERANCE = re.compile(
    r"^(ok |okay |thanks |thank you |merci )*(i am|i'm|im) (done|finished)$",
    re.I,
)


def looks_like_farewell(text: str) -> bool:
    cleaned = re.sub(r"[^\w\s']+", " ", (text or "").lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned or cleaned == TUTOR_GREETING.lower():
        return False
    if any(phrase in cleaned for phrase in _FAREWELL_PHRASES):
        return True
    return bool(_SHORT_FAREWELL.fullmatch(cleaned) or _DONE_UTTERANCE.fullmatch(cleaned))


END_SESSION_TOOL = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="end_session",
            description=(
                "Call this after you have said a short goodbye, when the student is "
                "ending the tutoring session (bye, goodbye, done for today, has to go, "
                "or asked to stop)."
            ),
            parameters={
                "type": "OBJECT",
                "properties": {
                    "reason": {
                        "type": "STRING",
                        "description": "Short reason the student is leaving",
                    }
                },
            },
        )
    ]
)

VISUAL_NOTE_TOOL = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="log_visual_observation",
            description=(
                "Silently record what you see on the student's paper or desk. "
                "Use this instead of speaking whenever you notice struggle, success, "
                "a visible mistake, a correction, a long pause, or clear progress. "
                "Do not say the note out loud. Do not mention this tool."
            ),
            parameters={
                "type": "OBJECT",
                "properties": {
                    "kind": {
                        "type": "STRING",
                        "description": "struggle | success | mistake | correction | pause | progress",
                    },
                    "note": {
                        "type": "STRING",
                        "description": (
                            "One or two factual sentences about what is visible, "
                            "including timing if relevant (for example 'paused about 20 seconds "
                            "before writing the next line')."
                        ),
                    },
                },
                "required": ["kind", "note"],
            },
        )
    ]
)

class GeminiLive:
    """
    Handles the interaction with the Gemini Live API.
    """
    def __init__(self, api_key, model, input_sample_rate, tools=None, tool_mapping=None):
        """
        Initializes the GeminiLive client.

        Args:
            api_key (str): The Gemini API Key.
            model (str): The model name to use.
            input_sample_rate (int): The sample rate for audio input.
            tools (list, optional): List of tools to enable. Defaults to None.
            tool_mapping (dict, optional): Mapping of tool names to functions. Defaults to None.
        """
        self.api_key = api_key
        self.model = model
        self.input_sample_rate = input_sample_rate
        self.client = genai.Client(api_key=api_key)
        self.tools = list(tools or []) + [END_SESSION_TOOL, VISUAL_NOTE_TOOL]
        self.tool_mapping = dict(tool_mapping or {})

    async def start_session(self, audio_input_queue, video_input_queue, text_input_queue, audio_output_callback, audio_interrupt_callback=None):
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            ),
            system_instruction=types.Content(parts=[types.Part(text=TUTOR_SYSTEM_INSTRUCTION)]),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                turn_coverage="TURN_INCLUDES_ONLY_ACTIVITY",
            ),
            tools=self.tools,
        )
        
        logger.info(f"Connecting to Gemini Live with model={self.model}")
        try:
          async with self.client.aio.live.connect(model=self.model, config=config) as session:
            logger.info("Gemini Live session opened successfully")
            
            async def send_audio():
                try:
                    while True:
                        chunk = await audio_input_queue.get()
                        await session.send_realtime_input(
                            audio=types.Blob(data=chunk, mime_type=f"audio/pcm;rate={self.input_sample_rate}")
                        )
                except asyncio.CancelledError:
                    logger.debug("send_audio task cancelled")
                except Exception as e:
                    logger.error(f"send_audio error: {e}\n{traceback.format_exc()}")

            greeting = {"sent": False}
            greeting_tasks: list[asyncio.Task] = []
            greeting_lock = asyncio.Lock()
            video_gate = asyncio.Event()

            async def send_greeting(delay: float) -> None:
                await asyncio.sleep(delay)
                async with greeting_lock:
                    if greeting["sent"]:
                        video_gate.set()
                        return
                    greeting["sent"] = True
                await text_input_queue.put(TUTOR_GREETING)
                video_gate.set()

            async def send_video():
                try:
                    first_frame = True
                    while True:
                        chunk = await video_input_queue.get()
                        if first_frame:
                            first_frame = False
                            greeting_tasks.append(asyncio.create_task(send_greeting(1.0)))
                        await video_gate.wait()
                        logger.info(f"Sending video frame to Gemini: {len(chunk)} bytes")
                        await session.send_realtime_input(
                            video=types.Blob(data=chunk, mime_type="image/jpeg")
                        )
                except asyncio.CancelledError:
                    logger.debug("send_video task cancelled")
                except Exception as e:
                    logger.error(f"send_video error: {e}\n{traceback.format_exc()}")

            closing = {"farewell": False, "tool": False, "emitted": False, "goodbye": False}
            user_turn = {"text": ""}

            async def send_text():
                try:
                    while True:
                        text = await text_input_queue.get()
                        logger.info(f"Sending text to Gemini: {text}")
                        if looks_like_farewell(text):
                            closing["farewell"] = True
                            logger.info("Typed/sent text looks like a session farewell")
                        await session.send_realtime_input(text=text)
                except asyncio.CancelledError:
                    logger.debug("send_text task cancelled")
                except Exception as e:
                    logger.error(f"send_text error: {e}\n{traceback.format_exc()}")

            event_queue = asyncio.Queue()

            async def emit_session_end():
                if closing["emitted"]:
                    return
                closing["emitted"] = True
                logger.info("Ending tutoring session after goodbye")
                await event_queue.put({"type": "session_end"})

            async def receive_loop():
                try:
                    while True:
                        async for response in session.receive():
                            logger.debug(f"Received response from Gemini: {response}")
                            
                            # Log the raw response type for debugging
                            if response.go_away:
                                logger.warning(f"Received GoAway from Gemini: {response.go_away}")
                            if response.session_resumption_update:
                                logger.info(f"Session resumption update: {response.session_resumption_update}")
                            
                            server_content = response.server_content
                            tool_call = response.tool_call
                            
                            if server_content:
                                if server_content.model_turn:
                                    for part in server_content.model_turn.parts:
                                        if part.inline_data:
                                            if closing["farewell"] or closing["tool"]:
                                                closing["goodbye"] = True
                                            if inspect.iscoroutinefunction(audio_output_callback):
                                                await audio_output_callback(part.inline_data.data)
                                            else:
                                                audio_output_callback(part.inline_data.data)
                                
                                if server_content.input_transcription and server_content.input_transcription.text:
                                    chunk = server_content.input_transcription.text
                                    user_turn["text"] += chunk
                                    if looks_like_farewell(user_turn["text"]):
                                        closing["farewell"] = True
                                        logger.info("Student farewell detected in transcript")
                                    await event_queue.put({"type": "user", "text": chunk})
                                
                                if server_content.output_transcription and server_content.output_transcription.text:
                                    if closing["farewell"] or closing["tool"]:
                                        closing["goodbye"] = True
                                    await event_queue.put({"type": "gemini", "text": server_content.output_transcription.text})
                                
                                if server_content.turn_complete:
                                    user_turn["text"] = ""
                                    await event_queue.put({"type": "turn_complete"})
                                    if closing["tool"] or (closing["farewell"] and closing["goodbye"]):
                                        await emit_session_end()
                                
                                if server_content.interrupted:
                                    if audio_interrupt_callback:
                                        if inspect.iscoroutinefunction(audio_interrupt_callback):
                                            await audio_interrupt_callback()
                                        else:
                                            audio_interrupt_callback()
                                    await event_queue.put({"type": "interrupted"})

                            if tool_call:
                                function_responses = []
                                for fc in tool_call.function_calls:
                                    func_name = fc.name
                                    args = fc.args or {}
                                    result = f"Unknown tool: {func_name}"

                                    if func_name == "end_session":
                                        closing["tool"] = True
                                        result = "Goodbye recorded. Finish speaking, then the session will close."
                                        logger.info("end_session tool called: %s", args)
                                    elif func_name == "log_visual_observation":
                                        allowed = {
                                            "struggle",
                                            "success",
                                            "mistake",
                                            "correction",
                                            "pause",
                                            "progress",
                                        }
                                        kind = str(args.get("kind") or "progress").strip().lower()
                                        if kind not in allowed:
                                            kind = "progress"
                                        note = str(args.get("note") or "").strip()
                                        result = "Logged silently. Do not speak this observation."
                                        if note:
                                            await event_queue.put(
                                                {"type": "observation", "kind": kind, "text": note}
                                            )
                                        logger.info("visual observation [%s]: %s", kind, note)
                                    elif func_name in self.tool_mapping:
                                        try:
                                            tool_func = self.tool_mapping[func_name]
                                            if inspect.iscoroutinefunction(tool_func):
                                                result = await tool_func(**args)
                                            else:
                                                loop = asyncio.get_running_loop()
                                                result = await loop.run_in_executor(None, lambda: tool_func(**args))
                                        except Exception as e:
                                            result = f"Error: {e}"

                                    function_responses.append(types.FunctionResponse(
                                        name=func_name,
                                        id=fc.id,
                                        response={"result": result}
                                    ))
                                    await event_queue.put({"type": "tool_call", "name": func_name, "args": args, "result": result})
                                
                                if function_responses:
                                    await session.send_tool_response(function_responses=function_responses)
                        
                        # session.receive() iterator ended (e.g. after turn_complete) — re-enter to keep listening
                        logger.debug("Gemini receive iterator completed, re-entering receive loop")

                except asyncio.CancelledError:
                    logger.debug("receive_loop task cancelled")
                except Exception as e:
                    logger.error(f"receive_loop error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
                    await event_queue.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
                finally:
                    logger.info("receive_loop exiting")
                    await event_queue.put(None)

            send_audio_task = asyncio.create_task(send_audio())
            send_video_task = asyncio.create_task(send_video())
            send_text_task = asyncio.create_task(send_text())
            receive_task = asyncio.create_task(receive_loop())
            greet_fallback_task = asyncio.create_task(send_greeting(4.0))
            greeting_tasks.append(greet_fallback_task)

            try:
                while True:
                    event = await event_queue.get()
                    if event is None:
                        break
                    if isinstance(event, dict) and event.get("type") == "error":
                        yield event
                        break
                    yield event
                    if isinstance(event, dict) and event.get("type") == "session_end":
                        # Let the goodbye audio finish streaming to the client.
                        await asyncio.sleep(2.5)
                        break
            finally:
                logger.info("Cleaning up Gemini Live session tasks")
                send_audio_task.cancel()
                send_video_task.cancel()
                send_text_task.cancel()
                receive_task.cancel()
                for task in greeting_tasks:
                    task.cancel()
        except Exception as e:
            logger.error(f"Gemini Live session error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
            raise
        finally:
            logger.info("Gemini Live session closed")
