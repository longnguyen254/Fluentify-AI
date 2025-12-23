
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AppStatus, AnalysisResult, SavedPhrase, ExerciseState, Difficulty } from './types';
import { analyzeSpeech, textToSpeech, generatePracticePhrase } from './services/geminiService';
import { blobToBase64, decodeBase64, decodeAudioData } from './utils/audioUtils';

// Helper Components
const Header = ({ onGoHome, difficulty, setDifficulty }: { 
  onGoHome: () => void, 
  difficulty: Difficulty, 
  setDifficulty: (d: Difficulty) => void 
}) => (
  <header className="py-6 px-4 bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
    <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-2 cursor-pointer" onClick={onGoHome}>
        <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-indigo-200">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Fluentify AI</h1>
      </div>
      
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
        {(['Easy', 'Medium', 'Hard'] as Difficulty[]).map((level) => (
          <button
            key={level}
            onClick={() => setDifficulty(level)}
            className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${
              difficulty === level 
                ? level === 'Easy' ? 'bg-emerald-500 text-white' : level === 'Medium' ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white'
                : 'text-slate-500 hover:bg-slate-200'
            }`}
          >
            {level === 'Easy' ? 'Dễ' : level === 'Medium' ? 'Vừa' : 'Khó'}
          </button>
        ))}
      </div>
    </div>
  </header>
);

const Footer = () => (
  <footer className="py-8 text-center text-slate-400 text-xs border-t border-slate-100 mt-auto">
    <p>© 2024 Fluentify AI. Dữ liệu được bảo vệ bởi Persistent Storage API.</p>
  </footer>
);

export default function App() {
  const [targetText, setTargetText] = useState("The quick brown fox jumps over the lazy dog.");
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  const [isStoragePersistent, setIsStoragePersistent] = useState(false);
  
  const [savedPhrases, setSavedPhrases] = useState<SavedPhrase[]>([]);
  const [phraseNote, setPhraseNote] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [exercise, setExercise] = useState<ExerciseState | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check and request persistent storage
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(persistent => {
        setIsStoragePersistent(persistent);
        console.log(persistent ? "Storage will not be cleared" : "Storage might be cleared by browser");
      });
    }

    const stored = localStorage.getItem('fluentify_phrases');
    if (stored) {
      try {
        setSavedPhrases(JSON.parse(stored));
      } catch (e) { console.error("Failed to parse saved phrases"); }
    }
    const storedDifficulty = localStorage.getItem('fluentify_difficulty');
    if (storedDifficulty) setDifficulty(storedDifficulty as Difficulty);
  }, []);

  useEffect(() => {
    localStorage.setItem('fluentify_difficulty', difficulty);
  }, [difficulty]);

  const updatePhraseScore = (id: string, score: number) => {
    const updated = savedPhrases.map(p => {
      if (p.id === id) {
        const newCount = (p.practiceCount || 0) + 1;
        return { ...p, lastScore: score, practiceCount: newCount };
      }
      return p;
    });
    setSavedPhrases(updated);
    localStorage.setItem('fluentify_phrases', JSON.stringify(updated));
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => e.data.size > 0 && audioChunksRef.current.push(e.data);
      mediaRecorder.onstop = () => handleProcessing(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
      mediaRecorder.start();
      setStatus(AppStatus.RECORDING);
      setResult(null);
      setErrorMessage("");
    } catch (err) {
      setErrorMessage("Không thể truy cập microphone.");
      setStatus(AppStatus.ERROR);
    }
  }, [targetText]);

  const stopRecording = () => {
    if (mediaRecorderRef.current && status === AppStatus.RECORDING) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handlePlayAudio = async (text: string, onEnd?: () => void) => {
    try {
      const base64Audio = await textToSpeech(text);
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
      const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), audioCtxRef.current, 24000, 1);
      const source = audioCtxRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtxRef.current.destination);
      source.onended = onEnd || null;
      source.start();
    } catch (err) {
      console.error("Audio playback failed:", err);
      if (onEnd) onEnd();
    }
  };

  const handleListen = async () => {
    if (!targetText.trim() || isTtsLoading) return;
    setIsTtsLoading(true);
    await handlePlayAudio(targetText.trim(), () => setIsTtsLoading(false));
  };

  const handleGenerateText = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setErrorMessage("");
    try {
      const phrase = await generatePracticePhrase();
      setTargetText(phrase);
      setResult(null);
      setStatus(AppStatus.IDLE);
    } catch (err) {
      console.error("Failed to generate phrase:", err);
      setErrorMessage("Không thể tạo câu gợi ý từ AI.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleProcessing = async (blob: Blob) => {
    setStatus(AppStatus.ANALYZING);
    try {
      const base64 = await blobToBase64(blob);
      const analysis = await analyzeSpeech(targetText, base64, difficulty);
      setResult(analysis);
      setStatus(AppStatus.RESULT);
      
      if (exercise) {
        const currentId = exercise.shuffledPhrases[exercise.currentPhraseIndex].id;
        updatePhraseScore(currentId, analysis.accuracyScore);
      }
    } catch (err) {
      setErrorMessage("Phân tích AI thất bại.");
      setStatus(AppStatus.ERROR);
    }
  };

  const handleSavePhrase = () => {
    if (!targetText.trim()) return;
    const newPhrase: SavedPhrase = {
      id: crypto.randomUUID(),
      text: targetText.trim(),
      note: phraseNote.trim(),
      timestamp: Date.now(),
      practiceCount: 0,
      lastScore: undefined
    };
    const updated = [newPhrase, ...savedPhrases];
    setSavedPhrases(updated);
    localStorage.setItem('fluentify_phrases', JSON.stringify(updated));
    setPhraseNote("");
    setShowSaveModal(false);
  };

  const deleteSavedPhrase = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Bạn có chắc chắn muốn xóa câu này khỏi thư viện?")) return;
    const updated = savedPhrases.filter(p => p.id !== id);
    setSavedPhrases(updated);
    localStorage.setItem('fluentify_phrases', JSON.stringify(updated));
  };

  const selectSavedPhrase = (phrase: SavedPhrase) => {
    setTargetText(phrase.text);
    setResult(null);
    setStatus(AppStatus.IDLE);
    setExercise(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const normalizeText = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const startExerciseMode = () => {
    if (savedPhrases.length === 0) return;
    const shuffled = [...savedPhrases].sort((a, b) => {
      const scoreA = a.lastScore ?? -1;
      const scoreB = b.lastScore ?? -1;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return Math.random() - 0.5;
    });

    setExercise({
      currentPhraseIndex: 0,
      shuffledPhrases: shuffled,
      step: 'WRITING',
      userInput: '',
      isWritingCorrect: false
    });
    setTargetText(shuffled[0].text);
    setStatus(AppStatus.EXERCISE);
    setResult(null);
  };

  const checkWriting = () => {
    if (!exercise) return;
    const current = exercise.shuffledPhrases[exercise.currentPhraseIndex];
    const targetWords = normalizeText(current.text).split(' ');
    const userWords = normalizeText(exercise.userInput).split(' ');
    let correctCount = 0;
    const diff = targetWords.map((word, idx) => {
      const isCorrect = userWords[idx] === word;
      if (isCorrect) correctCount++;
      return { word: current.text.split(' ')[idx] || word, isCorrect };
    });
    const score = Math.round((correctCount / targetWords.length) * 100);
    setExercise({ ...exercise, writingResult: { score, diff }, step: 'RESULT' });
    updatePhraseScore(current.id, score);
  };

  const nextExercisePhrase = () => {
    if (!exercise) return;
    const nextIndex = exercise.currentPhraseIndex + 1;
    if (nextIndex < exercise.shuffledPhrases.length) {
      const nextPhrase = exercise.shuffledPhrases[nextIndex];
      setExercise({ ...exercise, currentPhraseIndex: nextIndex, step: 'WRITING', userInput: '', writingResult: undefined });
      setTargetText(nextPhrase.text);
      setResult(null);
    } else {
      setExercise({ ...exercise, step: 'FINISHED' });
    }
  };

  const handlePlayWord = async (word: string) => {
    if (playingWord) return;
    setPlayingWord(word);
    await handlePlayAudio(word, () => setPlayingWord(null));
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(savedPhrases, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fluentify_backup_${new Date().toLocaleDateString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          if (confirm(`Bạn có muốn nhập ${json.length} câu vào thư viện hiện tại?`)) {
            const merged = [...json, ...savedPhrases];
            const unique = Array.from(new Map(merged.map(item => [item.text, item])).values());
            setSavedPhrases(unique);
            localStorage.setItem('fluentify_phrases', JSON.stringify(unique));
            alert("Đã nhập dữ liệu thành công!");
          }
        }
      } catch (err) {
        alert("File không đúng định dạng!");
      }
    };
    reader.readAsText(file);
  };

  const getScoreColor = (score?: number) => {
    if (score === undefined) return 'text-slate-400';
    if (score >= 90) return 'text-emerald-500';
    if (score >= 70) return 'text-amber-500';
    return 'text-rose-500';
  };

  const getDifficultyColor = (d: Difficulty) => {
    if (d === 'Easy') return 'text-emerald-600';
    if (d === 'Medium') return 'text-amber-600';
    return 'text-rose-600';
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header 
        onGoHome={() => { setStatus(AppStatus.IDLE); setExercise(null); setResult(null); }} 
        difficulty={difficulty} 
        setDifficulty={setDifficulty}
      />
      
      <main className="flex-grow max-w-4xl mx-auto w-full p-4 md:p-8 space-y-12">
        
        {/* EXERCISE MODE UI */}
        {status === AppStatus.EXERCISE && exercise && (
          <div className="animate-fade-in space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-800 tracking-tight">Ôn tập thông minh</h2>
                <p className="text-slate-500 font-medium">Câu {exercise.currentPhraseIndex + 1} / {exercise.shuffledPhrases.length}</p>
              </div>
              <button onClick={() => { setStatus(AppStatus.IDLE); setExercise(null); }} className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-300 transition-all">Thoát</button>
            </div>

            {exercise.step === 'FINISHED' ? (
              <div className="bg-white p-12 rounded-3xl shadow-xl border border-slate-100 text-center animate-scale-in">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                </div>
                <h3 className="text-3xl font-black text-slate-800 mb-2">Tuyệt vời!</h3>
                <p className="text-slate-500 mb-8 font-medium">Bạn đã hoàn thành vòng ôn tập này.</p>
                <button onClick={() => { setStatus(AppStatus.IDLE); setExercise(null); }} className="py-4 px-12 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100">Về trang chủ</button>
              </div>
            ) : (
              <div className="bg-white p-8 md:p-12 rounded-3xl shadow-xl border border-slate-100 space-y-8">
                {exercise.step === 'WRITING' && (
                  <div className="space-y-8 animate-fade-in">
                    <div className="space-y-4">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Gợi ý từ chú thích</label>
                      <div className="p-6 bg-amber-50 border-2 border-amber-100 rounded-2xl italic text-amber-900 font-medium">
                        {exercise.shuffledPhrases[exercise.currentPhraseIndex].note || "Câu này chưa có chú thích."}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Gõ lại câu tiếng Anh</label>
                      <textarea className="w-full p-5 text-lg rounded-2xl border-2 border-slate-100 focus:border-indigo-600 outline-none font-medium transition-all" placeholder="Gõ chính xác từng từ..." value={exercise.userInput} rows={3} onChange={(e) => setExercise({...exercise, userInput: e.target.value})} />
                    </div>
                    <button onClick={checkWriting} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">Kiểm tra kết quả viết</button>
                  </div>
                )}

                {(exercise.step === 'RESULT' || exercise.step === 'SPEAKING') && exercise.writingResult && (
                  <div className="space-y-8 animate-fade-in">
                    <div className="text-center space-y-2">
                       <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kết quả viết</h3>
                       <div className="text-4xl font-black text-indigo-600">{exercise.writingResult.score}%</div>
                       <div className="flex flex-wrap justify-center gap-1 text-xl font-medium mt-4">
                          {exercise.writingResult.diff.map((item, i) => (
                            <span key={i} className={item.isCorrect ? 'text-emerald-500' : 'text-rose-500 underline decoration-2'}>
                              {item.word}
                            </span>
                          ))}
                       </div>
                    </div>

                    <div className="pt-8 border-t border-slate-100 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" /></svg>
                          </div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Bước 2: Phát âm (Chế độ {difficulty})</label>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-center gap-6">
                        {status === AppStatus.ANALYZING ? (
                          <div className="text-center py-4">
                            <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mx-auto mb-2"></div>
                            <p className="text-xs font-bold text-slate-500 uppercase">AI đang chấm điểm nói...</p>
                          </div>
                        ) : result ? (
                          <div className="w-full p-6 bg-slate-50 rounded-2xl border border-slate-200 animate-fade-in space-y-4 text-center">
                            <div className="flex items-center justify-center gap-4">
                              <div className={`text-3xl font-black ${getScoreColor(result.accuracyScore)}`}>{result.accuracyScore}%</div>
                              <div className="text-slate-400 font-bold uppercase text-[10px]">Điểm nói</div>
                            </div>
                            <p className="text-slate-600 text-sm italic">"{result.transcription}"</p>
                            
                            {result.mispronouncedWords.length > 0 && (
                              <div className="flex flex-wrap justify-center gap-2 mt-4">
                                {result.mispronouncedWords.map((word, i) => (
                                  <button key={i} onClick={() => handlePlayWord(word)} disabled={!!playingWord} className="flex items-center gap-2 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-black shadow-sm hover:bg-rose-700 transition-all">
                                    {playingWord === word ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" /></svg>}
                                    {word}
                                  </button>
                                ))}
                              </div>
                            )}

                            <button onClick={nextExercisePhrase} className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100">Tiếp tục câu tiếp theo</button>
                          </div>
                        ) : (
                          <button onClick={status === AppStatus.RECORDING ? stopRecording : startRecording} className={`group relative flex items-center justify-center w-24 h-24 rounded-full text-white shadow-2xl transition-all active:scale-95 ${status === AppStatus.RECORDING ? 'bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                            {status === AppStatus.RECORDING ? <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" /></svg>}
                          </button>
                        )}
                        {!result && status !== AppStatus.RECORDING && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Bấm để ghi âm</p>}
                        {status === AppStatus.RECORDING && <p className="text-rose-500 text-xs font-black uppercase tracking-widest animate-pulse">Đang lắng nghe...</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* MAIN INTERFACE */}
        {status !== AppStatus.EXERCISE && (
          <div className="space-y-12">
            <section className="animate-fade-in space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Câu luyện tập</label>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 ${getDifficultyColor(difficulty)}`}>
                    Chế độ {difficulty === 'Easy' ? 'Dễ' : difficulty === 'Medium' ? 'Vừa' : 'Khó'}
                  </span>
                  {isStoragePersistent && (
                    <span className="flex items-center gap-1 text-[8px] font-black uppercase text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-2 w-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      Dữ liệu vĩnh viễn
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleGenerateText} disabled={isGenerating || status === AppStatus.RECORDING} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                    {isGenerating ? <div className="w-3 h-3 border-2 border-indigo-700 border-t-transparent rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>}
                    Gợi ý từ AI
                  </button>
                  <button onClick={() => setShowSaveModal(true)} disabled={!targetText.trim() || status === AppStatus.RECORDING} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 disabled:opacity-50">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                    Lưu câu
                  </button>
                  <button onClick={handleListen} disabled={isTtsLoading || !targetText.trim() || status === AppStatus.RECORDING} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-white text-indigo-600 border border-indigo-100 hover:bg-indigo-50 shadow-sm disabled:opacity-50">
                    {isTtsLoading ? <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>}
                    Nghe mẫu
                  </button>
                </div>
              </div>
              <textarea className={`w-full p-6 text-xl rounded-2xl border-2 transition-all outline-none focus:ring-4 focus:ring-indigo-100 font-medium ${status === AppStatus.RECORDING || status === AppStatus.ANALYZING ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-white border-indigo-100 hover:border-indigo-200'}`} rows={3} value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder="Nhập hoặc dán đoạn văn..." disabled={status === AppStatus.RECORDING || status === AppStatus.ANALYZING} />
            </section>

            <div className="bg-white p-8 md:p-10 rounded-3xl shadow-sm border border-slate-100 min-h-[300px] flex items-center justify-center">
              {status === AppStatus.IDLE && (
                <div className="text-center space-y-6 animate-fade-in">
                  <p className="text-slate-500 font-medium max-w-sm mx-auto">Sẵn sàng luyện tập chưa? AI Coach đang đợi bạn.</p>
                  <button onClick={startRecording} className="group relative flex items-center justify-center w-28 h-28 bg-indigo-600 rounded-full text-white shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95 hover:scale-105 mx-auto">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" /></svg>
                    <div className="absolute -bottom-10 w-48 text-center text-xs font-black text-indigo-600 uppercase tracking-widest">Bắt đầu nói</div>
                  </button>
                </div>
              )}

              {status === AppStatus.RECORDING && (
                <div className="text-center animate-fade-in w-full">
                  <div className="flex justify-center gap-1.5 mb-8 h-20 items-center">
                    {[...Array(12)].map((_, i) => <div key={i} className="w-2.5 bg-rose-500 rounded-full animate-bounce" style={{ height: `${30 + Math.random() * 70}%`, animationDelay: `${i * 0.05}s` }} />)}
                  </div>
                  <button onClick={stopRecording} className="w-24 h-24 bg-rose-500 rounded-full text-white shadow-xl hover:bg-rose-600 transition-all active:scale-95 flex items-center justify-center mx-auto">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  </button>
                  <p className="text-rose-600 font-black recording-pulse uppercase tracking-[0.3em] text-sm mt-8">Đang lắng nghe...</p>
                </div>
              )}

              {status === AppStatus.ANALYZING && (
                <div className="text-center py-10">
                  <div className="relative w-20 h-20 mx-auto mb-8">
                    <div className="absolute inset-0 border-4 border-indigo-50 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <p className="text-slate-800 text-xl font-black tracking-tight">AI đang chấm điểm (Chế độ {difficulty})...</p>
                </div>
              )}

              {status === AppStatus.RESULT && result && (
                <div className="w-full animate-fade-in-up">
                   <div className="flex flex-col md:flex-row gap-8 items-start">
                      <div className="flex-shrink-0 mx-auto md:mx-0">
                        <div className={`w-32 h-32 rounded-full border-[10px] flex flex-col items-center justify-center shadow-lg ${result.accuracyScore >= 90 ? 'border-emerald-500 text-emerald-600 bg-emerald-50' : result.accuracyScore >= 70 ? 'border-amber-500 text-amber-600 bg-amber-50' : 'border-rose-500 text-rose-600 bg-rose-50'}`}>
                          <span className="text-4xl font-black">{result.accuracyScore}</span>
                          <span className="text-[8px] font-black uppercase tracking-[0.2em]">Điểm nói</span>
                        </div>
                      </div>
                      <div className="flex-grow space-y-6 w-full">
                        <div className="space-y-2">
                          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AI nghe thấy</h3>
                          <p className="p-4 rounded-xl border-2 text-lg italic font-medium bg-slate-50 border-slate-100 text-slate-800">"{result.transcription}"</p>
                        </div>
                        
                        {result.mispronouncedWords.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Các từ chưa chuẩn (bấm để nghe mẫu)</h3>
                            <div className="flex flex-wrap gap-2">
                              {result.mispronouncedWords.map((word, i) => (
                                <button key={i} onClick={() => handlePlayWord(word)} disabled={!!playingWord} className="flex items-center gap-2 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-black shadow-sm hover:bg-rose-700 transition-all active:scale-95">
                                  {playingWord === word ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" /></svg>}
                                  {word}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
                            <h4 className="font-black text-indigo-900 text-[9px] uppercase tracking-widest mb-2">Nhận xét của Coach</h4>
                            <p className="text-slate-700 text-xs leading-loose whitespace-pre-line font-medium">{result.feedback}</p>
                          </div>
                          <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
                            <h4 className="font-black text-emerald-900 text-[9px] uppercase tracking-widest mb-2">Mẹo cải thiện</h4>
                            <p className="text-slate-700 text-xs leading-loose whitespace-pre-line font-medium">{result.tips}</p>
                          </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button onClick={startRecording} className="flex-grow py-4 px-6 bg-indigo-600 text-white rounded-xl font-black text-sm shadow-md hover:bg-indigo-700 transition-all active:scale-[0.98]">Nói lại câu này</button>
                          <button onClick={() => setStatus(AppStatus.IDLE)} className="py-4 px-8 bg-slate-100 text-slate-700 rounded-xl font-black text-sm hover:bg-slate-200 transition-all">Xong</button>
                        </div>
                      </div>
                   </div>
                </div>
              )}
            </div>

            <section className="animate-fade-in-up">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight">Thư viện ôn tập ({savedPhrases.length})</h2>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-white rounded-xl border border-slate-200 shadow-sm" title="Quản lý dữ liệu">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </button>
                  {savedPhrases.length > 0 && (
                    <button onClick={startExerciseMode} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95">
                      🔥 Ôn tập thông minh
                    </button>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-4">
                {savedPhrases.length === 0 ? (
                  <div className="p-12 border-2 border-dashed border-slate-200 rounded-3xl text-center bg-white/50">
                    <p className="text-slate-400 font-medium italic text-sm">Chưa có câu nào được lưu.</p>
                  </div>
                ) : (
                  savedPhrases.map((phrase) => (
                    <div key={phrase.id} onClick={() => selectSavedPhrase(phrase)} className="group p-5 bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer relative">
                      <div className="flex items-start justify-between">
                        <div className="pr-12 space-y-1">
                          <p className="text-slate-800 font-bold text-lg leading-tight group-hover:text-indigo-600 transition-colors">{phrase.text}</p>
                          {phrase.note && <p className="text-xs text-slate-500 italic">"{phrase.note}"</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className={`text-xs font-black ${getScoreColor(phrase.lastScore)}`}>
                            {phrase.lastScore !== undefined ? `${phrase.lastScore}%` : '---'}
                          </div>
                          <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Độ chính xác</div>
                        </div>
                      </div>
                      <button onClick={(e) => deleteSavedPhrase(phrase.id, e)} className="absolute bottom-4 right-5 p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all rounded-lg bg-slate-50">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* SAVE MODAL */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 animate-scale-in">
            <h3 className="text-xl font-black text-slate-800 mb-2">Lưu vào thư viện</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Nội dung câu</label>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-slate-800 font-bold italic text-sm">"{targetText}"</div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Gợi ý khi ôn tập (nghĩa, nối âm...)</label>
                <textarea className="w-full p-4 rounded-xl border-2 border-slate-100 focus:border-indigo-600 outline-none transition-all font-medium text-sm" rows={3} placeholder="Ví dụ: Đọc nối âm 'check it out'..." value={phraseNote} onChange={(e) => setPhraseNote(e.target.value)} autoFocus />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowSaveModal(false)} className="flex-grow py-4 px-6 bg-slate-100 text-slate-600 font-black rounded-2xl text-sm">Hủy</button>
                <button onClick={handleSavePhrase} className="flex-grow py-4 px-6 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-100 text-sm">Lưu ngay</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS / DATA MANAGEMENT MODAL */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-8 animate-scale-in">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Trung tâm Dữ liệu</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="space-y-6">
              <div className="p-6 bg-indigo-50 rounded-2xl border border-indigo-100 space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${isStoragePersistent ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 animate-pulse'}`}></div>
                  <span className="text-sm font-black text-indigo-900 uppercase tracking-widest">Trạng thái: {isStoragePersistent ? 'Bảo mật vĩnh viễn' : 'Cục bộ (Tạm thời)'}</span>
                </div>
                <p className="text-xs text-indigo-700 leading-relaxed">
                  {isStoragePersistent 
                    ? "Trình duyệt đã cấp quyền lưu trữ ưu tiên cao nhất. Dữ liệu của bạn sẽ không bị xóa trừ khi bạn gỡ ứng dụng hoặc xóa cache thủ công." 
                    : "Đang lưu trữ trong bộ nhớ đệm. Hãy thực hiện Sao lưu thường xuyên để đảm bảo an toàn."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button onClick={handleExport} className="flex flex-col items-center gap-4 p-6 bg-white border-2 border-slate-100 rounded-2xl hover:border-indigo-600 hover:bg-indigo-50/30 transition-all group">
                  <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black text-slate-800">Sao lưu file</div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Tải file .json</div>
                  </div>
                </button>

                <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-4 p-6 bg-white border-2 border-slate-100 rounded-2xl hover:border-emerald-600 hover:bg-emerald-50/30 transition-all group">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black text-slate-800">Khôi phục</div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Nhập từ file</div>
                  </div>
                </button>
              </div>

              <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".json" />

              <div className="pt-4 text-center">
                <button onClick={() => { 
                  if (confirm("Xóa toàn bộ thư viện? Hành động này không thể hoàn tác!")) {
                    setSavedPhrases([]);
                    localStorage.removeItem('fluentify_phrases');
                    setShowSettings(false);
                  }
                }} className="text-rose-500 text-[10px] font-black uppercase tracking-[0.2em] hover:underline">Xóa sạch toàn bộ thư viện</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
