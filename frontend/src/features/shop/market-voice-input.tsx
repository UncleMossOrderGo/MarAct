import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square } from 'lucide-react';
import type { DailyLocale } from './market-daily-types';
import './market-voice-input.css';

type Status = 'idle' | 'permission' | 'recording' | 'transcribing';
type Recording = {
  controller: AbortController;
  recorder?: MediaRecorder;
  stream?: MediaStream;
  timer?: number;
};
type Props = {
  shopId: string;
  locale: DailyLocale;
  disabled: boolean;
  onTranscript: (text: string) => void;
};
const labels = {
  en: {
    start: 'Dictate a message', stop: 'Stop and transcribe', permission: 'Allow microphone access to dictate.',
    recording: 'Recording · up to 60 seconds', transcribing: 'Transcribing…',
    unavailable: 'Voice recording is unavailable in this browser.',
    denied: 'Microphone access is blocked. Allow access in browser settings to dictate.',
    failed: 'Voice transcription failed. Try again or type your message.',
    empty: 'No speech recognized. Try recording again.',
  },
  th: {
    start: 'พิมพ์ข้อความด้วยเสียง', stop: 'หยุดและถอดเสียง', permission: 'อนุญาตให้ใช้ไมโครโฟนเพื่อบันทึกเสียง',
    recording: 'กำลังบันทึกเสียง · สูงสุด 60 วินาที', transcribing: 'กำลังถอดเสียง…',
    unavailable: 'เบราว์เซอร์นี้ไม่รองรับการบันทึกเสียง',
    denied: 'โปรดอนุญาตให้ใช้ไมโครโฟนในการตั้งค่าเบราว์เซอร์',
    failed: 'ถอดเสียงไม่สำเร็จ ลองอีกครั้งหรือพิมพ์ข้อความ',
    empty: 'ไม่พบเสียงพูด กรุณาลองบันทึกอีกครั้ง',
  },
};
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
const limit = 4 * 1024 * 1024;

function release(clip: Recording) {
  window.clearTimeout(clip.timer);
  if (clip.recorder && clip.recorder.state !== 'inactive') clip.recorder.stop();
  clip.stream?.getTracks().forEach((track) => track.stop());
}

export function MarketVoiceInput({ shopId, locale, disabled, onTranscript }: Props) {
  const copy = labels[locale];
  const button = useRef<HTMLButtonElement>(null);
  const current = useRef<Recording | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const dialog = button.current?.closest('dialog');
    function discard() {
      const clip = current.current;
      if (clip) {
        current.current = null;
        clip.controller.abort();
        release(clip);
      }
      setStatus('idle');
      setMessage('');
    }
    dialog?.addEventListener('close', discard);
    return () => { dialog?.removeEventListener('close', discard); discard(); };
  }, [shopId, locale, disabled]);

  async function start() {
    if (current.current || disabled) return;
    const format = window.MediaRecorder && formats.find((mime) => MediaRecorder.isTypeSupported(mime));
    if (!format || !navigator.mediaDevices?.getUserMedia) { setMessage(copy.unavailable); return; }
    const clip: Recording = { controller: new AbortController() };
    current.current = clip;
    setStatus('permission');
    setMessage('');
    try {
      clip.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (clip.controller.signal.aborted) { release(clip); return; }
      const recorder = new MediaRecorder(clip.stream, { mimeType: format, audioBitsPerSecond: 64000 });
      clip.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = ({ data }) => {
        bytes += data.size;
        if (bytes <= limit) chunks.push(data);
        else if (recorder.state === 'recording') recorder.stop();
      };
      recorder.onerror = () => {
        if (current.current !== clip) return;
        clip.controller.abort();
        current.current = null;
        release(clip);
        setStatus('idle');
        setMessage(copy.failed);
      };
      recorder.onstop = async () => {
        release(clip);
        if (clip.controller.signal.aborted) return;
        setStatus('transcribing');
        try {
          if (!bytes || bytes > limit) throw new Error(copy.failed);
          const reply = await fetch(
            `/api/shop/shops/${encodeURIComponent(shopId)}/agent/transcriptions?locale=${locale}`,
            { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }), signal: clip.controller.signal },
          );
          if (!reply.ok) throw new Error(reply.status === 422 ? copy.empty : copy.failed);
          const { text } = await reply.json();
          if (typeof text !== 'string' || !text.trim()) throw new Error(copy.empty);
          if (!clip.controller.signal.aborted) onTranscript(text.trim());
        } catch (error) {
          if (!clip.controller.signal.aborted) setMessage(error instanceof Error && error.message === copy.empty ? copy.empty : copy.failed);
        } finally {
          if (current.current === clip) { current.current = null; setStatus('idle'); }
        }
      };
      recorder.start(1000);
      clip.timer = window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 60000);
      setStatus('recording');
    } catch (error) {
      release(clip);
      if (current.current === clip) {
        current.current = null;
        setStatus('idle');
        setMessage(error instanceof DOMException && error.name === 'NotAllowedError' ? copy.denied : copy.failed);
      }
    }
  }

  const recording = status === 'recording';
  const hint = status === 'idle' ? message : copy[status];
  return <span className="market-voice">
    <button ref={button} type="button" className="market-voice-button" data-state={status}
      aria-label={recording ? copy.stop : copy.start} title={recording ? copy.stop : copy.start}
      disabled={disabled || status === 'permission' || status === 'transcribing'}
      onClick={() => recording ? current.current?.recorder?.stop() : void start()}>
      {recording ? <Square size={15} fill="currentColor" /> : status === 'transcribing'
        ? <LoaderCircle size={18} /> : <Mic size={18} />}
    </button>
    <span role="status" className="market-voice-status">{hint}</span>
  </span>;
}
