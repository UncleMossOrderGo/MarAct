import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

interface Recognizer {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function VoiceInput({ onText, onNotice }: {
  onText: (text: string) => void;
  onNotice: (message: string) => void;
}) {
  const active = useRef<Recognizer | null>(null);
  const [listening, setListening] = useState(false);
  useEffect(() => () => {
    const recognition = active.current;
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.abort();
    }
  }, []);

  function toggle() {
    if (active.current) { active.current.stop(); return; }
    const browser = window as Window & {
      SpeechRecognition?: new () => Recognizer;
      webkitSpeechRecognition?: new () => Recognizer;
    };
    const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Speech) { onNotice('เบราว์เซอร์นี้ยังไม่รองรับการพิมพ์ด้วยเสียง'); return; }
    const recognition = new Speech();
    recognition.lang = 'th-TH';
    recognition.onresult = event => {
      const transcript = Array.from(event.results, r => r[0]?.transcript ?? '').join(' ').trim();
      if (transcript) onText(transcript);
    };
    recognition.onerror = event => onNotice(event.error === 'not-allowed'
      ? 'กรุณาอนุญาตให้ใช้ไมโครโฟนในเบราว์เซอร์'
      : 'รับเสียงไม่ได้ กรุณาลองอีกครั้งหรือพิมพ์คำถาม');
    recognition.onend = () => { active.current = null; setListening(false); };
    try {
      onNotice('');
      recognition.start();
      active.current = recognition;
      setListening(true);
    } catch { onNotice('เปิดไมโครโฟนไม่ได้ กรุณาตรวจสิทธิ์แล้วลองอีกครั้ง'); }
  }

  const label = listening ? 'หยุดฟังเสียง' : 'พิมพ์ด้วยเสียง';
  return <button type="button" aria-label={label} title={label} aria-pressed={listening} onClick={toggle}>
    {listening ? <Square size={17}/> : <Mic size={19}/>}
  </button>;
}
