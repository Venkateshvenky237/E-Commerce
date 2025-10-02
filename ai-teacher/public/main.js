const startBtn = document.getElementById('startBtn');
const transcriptEl = document.getElementById('transcript');
const voiceSelect = document.getElementById('voiceSelect');
const personaEl = document.getElementById('persona');
const memoryEl = document.getElementById('memory');

let pc; // RTCPeerConnection
let micStream;
let remoteAudio;
let audioContext;
let levelNode;

function appendTranscript(role, text){
  const div = document.createElement('div');
  div.textContent = `${role}: ${text}`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function setMouth(open){
  const mouth = document.getElementById('mouth');
  if (!mouth) return;
  if (open){
    mouth.setAttribute('y', '120');
    mouth.setAttribute('height', '18');
    mouth.setAttribute('rx', '6');
  } else {
    mouth.setAttribute('y', '125');
    mouth.setAttribute('height', '4');
    mouth.setAttribute('rx', '2');
  }
}

function loadPrefs(){
  const persona = localStorage.getItem('ai_teacher_persona');
  const memory = localStorage.getItem('ai_teacher_memory');
  if (persona) personaEl.value = persona;
  if (memory) memoryEl.value = memory;
}
function savePrefs(){
  localStorage.setItem('ai_teacher_persona', personaEl.value.trim());
  localStorage.setItem('ai_teacher_memory', memoryEl.value.trim());
}
personaEl.addEventListener('input', savePrefs);
memoryEl.addEventListener('input', savePrefs);
loadPrefs();

async function monitorMic(stream){
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  const levelEl = document.getElementById('level');

  function tick(){
    analyser.getByteTimeDomainData(data);
    // Compute RMS
    let sum = 0;
    for (let i=0;i<data.length;i++){
      const v = (data[i]-128)/128;
      sum += v*v;
    }
    const rms = Math.sqrt(sum/data.length);
    const pct = Math.min(1, rms*6);
    levelEl.style.width = `${pct*100}%`;
    requestAnimationFrame(tick);
  }
  tick();
}

async function createSession(){
  const res = await fetch('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona: personaEl.value.trim(),
      memory: memoryEl.value.trim()
    })
  });
  if (!res.ok){
    throw new Error(await res.text());
  }
  return res.json();
}

async function initRealtime(){
  const session = await createSession();

  // Browser connects to Realtime via WebRTC using the returned client_secret or similar
  pc = new RTCPeerConnection();

  // Incoming audio from model
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  remoteAudio = audioEl;

  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    audioEl.srcObject = remoteStream;

    // Animate mouth on audio playback
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(remoteStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    function tick(){
      analyser.getByteTimeDomainData(data);
      let sum=0; for (let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
      const rms = Math.sqrt(sum/data.length);
      setMouth(rms>0.03);
      requestAnimationFrame(tick);
    }
    tick();
  };

  // Mic
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  monitorMic(micStream);
  micStream.getTracks().forEach(t => pc.addTrack(t, micStream));

  // Receive server-created data channel carrying model events
  pc.ondatachannel = (event) => {
    const channel = event.channel;
    channel.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'response.delta' && msg.delta){
          appendTranscript('Teacher', msg.delta);
        }
        if (msg.type === 'response.completed' && msg.response?.output_text){
          appendTranscript('Teacher', msg.response.output_text);
        }
        if (msg.type === 'input_audio_transcript.delta' && msg.delta){
          appendTranscript('You', msg.delta);
        }
      } catch(_){}
    };
  };

  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);

  // Send SDP to OpenAI Realtime server
  const baseUrl = (session.base_url || 'https://api.openai.com');
  const sdpRes = await fetch(`${baseUrl}/v1/realtime?model=${encodeURIComponent(session.model)}`, {
    method: 'POST',
    body: offer.sdp,
    headers: {
      'Authorization': `Bearer ${session.client_secret?.value || session.client_secret || ''}`,
      'Content-Type': 'application/sdp',
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  if (!sdpRes.ok){
    const errText = await sdpRes.text();
    throw new Error(`Realtime SDP failed: ${sdpRes.status} ${errText}`);
  }

  const answer = { type: 'answer', sdp: await sdpRes.text() };
  await pc.setRemoteDescription(answer);

  appendTranscript('System', 'Realtime session started. Speak to the teacher.');
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try{
    await initRealtime();
  } catch (e){
    console.error(e);
    alert('Failed to start: '+e.message);
  } finally {
    startBtn.disabled = false;
  }
});
