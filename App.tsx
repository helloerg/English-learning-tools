
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AppStage, LearningSession, WordDetail, VocabularyWord, EBBINGHAUS_INTERVALS, UserGoals } from './types';
import { extractTextFromImage, analyzeWord, compareTranslations, evaluatePracticeSentence, generateSpeech, evaluatePronunciation } from './services/gemini';
import { 
  Plus, X, Camera, BookOpen, History, ChevronRight, CheckCircle, Loader2,
  Trash2, BrainCircuit, Star, PencilLine, ChevronLeft, ListMusic, Volume2,
  Mic, Languages, Eye, EyeOff, Square, Monitor, Type as TypeIcon, Send, RefreshCw,
  MessageSquare, User, Info, Bell, BellOff, Quote, Target, Trophy, Settings, AlertCircle, Clock
} from 'lucide-react';

const App: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<AppStage>(AppStage.IDLE);
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyWord[]>([]);
  const [currentSession, setCurrentSession] = useState<Partial<LearningSession>>({});
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [selectedWord, setSelectedWord] = useState<WordDetail | null>(null);
  const [userInput, setUserInput] = useState("");
  const [manualEnglishInput, setManualEnglishInput] = useState("");
  const [practiceSentence, setPracticeSentence] = useState("");
  const [practiceFeedback, setPracticeFeedback] = useState<any>(null);
  
  // Real-time clock to refresh "Due" status without page reload
  const [now, setNow] = useState(Date.now());

  // Goals State
  const [goals, setGoals] = useState<UserGoals>({ dailyNewWords: 5, dailyReviews: 10 });
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // Feedback state
  const [feedbackCategory, setFeedbackCategory] = useState<'BUG' | 'SUGGESTION' | 'OTHER'>('SUGGESTION');
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [pronunciationResult, setPronunciationResult] = useState<{ score: number; feedback: string; transcription: string; corrections: string[] } | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Update clock every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Derived daily progress
  const dailyProgress = useMemo(() => {
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const newWordsCount = vocabulary.filter(v => v.addedAt >= startOfDay).length;
    const reviewsCount = sessions.filter(s => s.lastReviewedAt && s.lastReviewedAt >= startOfDay).length;
    return { newWords: newWordsCount, reviews: reviewsCount };
  }, [vocabulary, sessions]);

  // Count items currently due for review
  const dueCount = useMemo(() => {
    return sessions.filter(s => s.nextReviewAt <= now).length;
  }, [sessions, now]);

  // Local Storage Load
  useEffect(() => {
    const savedSessions = localStorage.getItem('linguist_sessions');
    if (savedSessions) setSessions(JSON.parse(savedSessions));
    const savedVocab = localStorage.getItem('linguist_vocab');
    if (savedVocab) setVocabulary(JSON.parse(savedVocab));
    const savedGoals = localStorage.getItem('linguist_goals');
    if (savedGoals) setGoals(JSON.parse(savedGoals));
    
    if ('Notification' in window) {
      setNotificationsEnabled(Notification.permission === 'granted');
    }
  }, []);

  // Local Storage Sync
  useEffect(() => {
    localStorage.setItem('linguist_sessions', JSON.stringify(sessions));
    localStorage.setItem('linguist_vocab', JSON.stringify(vocabulary));
    localStorage.setItem('linguist_goals', JSON.stringify(goals));
  }, [sessions, vocabulary, goals]);

  // Background check for due reviews
  useEffect(() => {
    const checkReviews = () => {
      if (Notification.permission !== 'granted') return;
      const dueSessions = sessions.filter(s => 
        s.nextReviewAt <= Date.now() && 
        (!s.lastNotifiedAt || s.lastNotifiedAt < s.nextReviewAt)
      );
      if (dueSessions.length > 0) {
        const firstSession = dueSessions[0];
        const n = new Notification('LinguistPro: 学习时间到！', {
          body: `你有 ${dueSessions.length} 项内容待复习。点击开始学习！`,
          tag: 'linguist-review',
          requireInteraction: true
        });
        n.onclick = () => {
          window.focus();
          setCurrentSession(firstSession);
          setStage(AppStage.COMPARISON);
          setIsOpen(true);
          n.close();
        };
        // Update lastNotifiedAt to prevent duplicate alerts for the same review stage
        setSessions(prev => prev.map(s => dueSessions.some(ds => ds.id === s.id) ? { ...s, lastNotifiedAt: Date.now() } : s));
      }
    };
    const interval = setInterval(checkReviews, 60000); 
    return () => clearInterval(interval);
  }, [sessions]);

  const toggleNotifications = async () => {
    if (!('Notification' in window)) return alert("您的浏览器不支持通知");
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setNotificationsEnabled(permission === 'granted');
    } else if (Notification.permission === 'denied') {
      alert("请在浏览器设置中手动开启通知权限");
    } else {
      setNotificationsEnabled(Notification.permission === 'granted');
    }
  };

  const playTTS = async (text: string) => {
    if (audioLoading || !text) return;
    setAudioLoading(true);
    try {
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const ctx = audioContextRef.current;
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        const audioData = atob(base64Audio);
        const bytes = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) bytes[i] = audioData.charCodeAt(i);
        const dataInt16 = new Int16Array(bytes.buffer);
        const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start();
      }
    } catch (err) { console.error(err); } finally { setAudioLoading(false); }
  };

  const startRecording = async (targetText: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setLoading(true);
          try {
            const result = await evaluatePronunciation(base64, targetText);
            setPronunciationResult(result);
          } catch (err) { console.error(err); } finally { setLoading(false); }
        };
      };
      mediaRecorder.start();
      setIsRecording(true);
      setPronunciationResult(null);
    } catch (err) { alert("麦克风启动失败"); }
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };

  const processImageBase64 = async (base64: string) => {
    setLoading(true);
    try {
      const text = await extractTextFromImage(base64);
      setCurrentSession({
        id: Date.now().toString(),
        extractedText: text,
        words: [],
        createdAt: Date.now(),
        reviewCount: 0,
        nextReviewAt: Date.now() + 86400000, // Default 1 day for first review
      });
      setStage(AppStage.OCR_RESULT);
    } catch (err) { alert("文字提取失败"); } finally { setLoading(false); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      processImageBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleScreenCapture = async () => {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      await new Promise((resolve) => { video.onloadedmetadata = resolve; });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      processImageBase64(base64);
      stream.getTracks().forEach((track: any) => track.stop());
    } catch (err) {
      console.error(err);
      alert("屏幕截取失败");
    }
  };

  const handleManualSubmit = () => {
    if (!manualEnglishInput.trim()) return;
    setCurrentSession({
      id: Date.now().toString(),
      extractedText: manualEnglishInput,
      words: [],
      createdAt: Date.now(),
      reviewCount: 0,
      nextReviewAt: Date.now() + 86400000,
    });
    setManualEnglishInput("");
    setStage(AppStage.OCR_RESULT);
  };

  const handleWordClick = async (word: string) => {
    const cleanWord = word.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"");
    if (!cleanWord) return;
    setLoading(true);
    try {
      const context = currentSession.extractedText || "";
      const result = await analyzeWord(cleanWord, context);
      setSelectedWord(result);
    } catch (err) {
      console.error(err);
      alert("单词分析失败");
    } finally {
      setLoading(false);
    }
  };

  const handlePracticeSubmit = async () => {
    if (!selectedWord || !practiceSentence.trim()) return;
    setLoading(true);
    try {
      const result = await evaluatePracticeSentence(selectedWord.word, practiceSentence);
      setPracticeFeedback(result);
    } catch (err) {
      console.error(err);
      alert("造句评估失败");
    } finally {
      setLoading(false);
    }
  };

  // Full Ebbinghaus Sync Logic
  const handleFinishLearning = () => {
    if (!currentSession.id) return;
    
    setSessions(prev => {
      const existing = prev.find(s => s.id === currentSession.id);
      
      if (existing) {
        // Increment Ebbinghaus stage
        const nextIntervalIndex = Math.min((existing.reviewCount || 0) + 1, EBBINGHAUS_INTERVALS.length - 1);
        const daysToAdd = EBBINGHAUS_INTERVALS[nextIntervalIndex];
        
        return prev.map(s => s.id === currentSession.id ? {
          ...s,
          reviewCount: (s.reviewCount || 0) + 1,
          nextReviewAt: Date.now() + (daysToAdd * 24 * 60 * 60 * 1000),
          lastNotifiedAt: 0,
          lastReviewedAt: Date.now()
        } : s);
      } else {
        // New session entry
        const firstIntervalDays = EBBINGHAUS_INTERVALS[0];
        const newSession: LearningSession = {
          ...(currentSession as LearningSession),
          reviewCount: 1,
          nextReviewAt: Date.now() + (firstIntervalDays * 24 * 60 * 60 * 1000),
          lastReviewedAt: Date.now()
        };
        return [newSession, ...prev];
      }
    });

    setIsOpen(false);
    setStage(AppStage.IDLE);
    setCurrentSession({});
    setSelectedWord(null);
    setUserInput("");
  };

  const handleFeedbackSubmit = () => {
    if (!feedbackText.trim()) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setFeedbackSuccess(true);
      setFeedbackText("");
      setTimeout(() => { setFeedbackSuccess(false); setStage(AppStage.IDLE); setIsOpen(false); }, 2000);
    }, 1500);
  };

  const isWordInVocab = (word: string) => vocabulary.some(v => v.word.toLowerCase() === word.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"").toLowerCase());

  // Generalized interactive text renderer for main text and examples
  const renderInteractiveText = (text: string, isLight: boolean = false) => {
    if (!text) return null;
    return text.split(/\s+/).map((word, idx) => (
      <span key={idx} onClick={(e) => { e.stopPropagation(); handleWordClick(word); }}
        className={`cursor-pointer px-0.5 rounded transition-all inline-block ${
          isWordInVocab(word) 
            ? 'bg-yellow-200 text-yellow-900 font-bold scale-105' 
            : isLight ? 'hover:bg-white/20' : 'hover:bg-blue-200'
        }`}
      >{word}{' '}</span>
    ));
  };

  const renderTranscriptionWithHighlights = (transcription: string, corrections: string[]) => {
    if (!transcription) return null;
    const words = transcription.split(/\s+/);
    return words.map((word, idx) => {
      const cleanWord = word.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").toLowerCase();
      const isError = corrections.some(err => err.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").toLowerCase() === cleanWord);
      return <span key={idx} className={`inline-block px-1 rounded mx-0.5 ${isError ? 'bg-red-100 text-red-600 font-bold underline decoration-wavy' : 'text-gray-700'}`}>{word}</span>;
    });
  };

  const ProgressBar = ({ current, goal, label, colorClass }: { current: number, goal: number, label: string, colorClass: string }) => {
    const percentage = Math.min(Math.round((current / goal) * 100), 100);
    const isCompleted = current >= goal;
    return (
      <div className="space-y-1">
        <div className="flex justify-between items-end">
          <p className="text-xs font-bold text-gray-500">{label}</p>
          <p className={`text-xs font-black ${isCompleted ? 'text-green-600' : 'text-gray-700'}`}>{current}/{goal} {isCompleted && '✓'}</p>
        </div>
        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-1000 ease-out ${colorClass}`} style={{ width: `${percentage}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none opacity-20 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-blue-300 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-purple-300 rounded-full blur-3xl" />
      </div>

      <div className="p-4 md:p-8 max-w-4xl mx-auto w-full flex-1">
        <header className="mb-8 flex justify-between items-start">
            <div className="cursor-pointer" onClick={() => { setStage(AppStage.IDLE); setIsOpen(false); }}>
              <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-1 flex items-center gap-3">
                <BrainCircuit className="text-blue-600 w-8 h-8 md:w-10 md:h-10" /> LinguistPro AI
              </h1>
              <p className="text-gray-500 text-sm md:text-lg">智能艾宾浩斯英语实验室</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setIsOpen(true); setStage(AppStage.FEEDBACK); }} className="p-3 bg-white shadow-sm border border-gray-100 rounded-2xl text-gray-500 hover:text-blue-600 transition-all"><MessageSquare className="w-5 h-5"/></button>
              <button onClick={() => { setIsOpen(true); setStage(AppStage.GOALS); }} className="p-3 bg-white shadow-sm border border-gray-100 rounded-2xl text-gray-500 hover:text-blue-600 transition-all"><Settings className="w-5 h-5"/></button>
            </div>
        </header>

        {/* Hero Progress Section */}
        <div className="glass-morphism p-6 rounded-3xl shadow-xl border border-white mb-8 flex flex-col md:flex-row gap-6 md:items-center">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all ${dailyProgress.newWords >= goals.dailyNewWords && dailyProgress.reviews >= goals.dailyReviews ? 'bg-yellow-400 text-white scale-110' : 'bg-blue-600 text-white'}`}>
              <Trophy className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-900">今日学习进度</h2>
              <p className="text-xs text-gray-500">对抗遗忘，坚持是唯一的捷径</p>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ProgressBar current={dailyProgress.newWords} goal={goals.dailyNewWords} label="今日录入" colorClass="bg-blue-500" />
            <ProgressBar current={dailyProgress.reviews} goal={goals.dailyReviews} label="今日复习" colorClass="bg-purple-500" />
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
           {/* Vocabulary Mini List */}
           <div className="glass-morphism p-6 rounded-3xl shadow-xl border border-white flex flex-col">
              <h2 className="text-lg font-bold mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2"><ListMusic className="w-5 h-5 text-blue-500" /> 生词本 ({vocabulary.length})</span>
                <button onClick={() => { setIsOpen(true); setStage(AppStage.VOCABULARY); }} className="text-xs text-blue-500 hover:underline">查看全部</button>
              </h2>
              <div className="space-y-3 h-48 md:h-64 overflow-y-auto scrollbar-hide">
                {vocabulary.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50 space-y-2">
                    <AlertCircle className="w-8 h-8" />
                    <p className="text-sm italic">尚无收藏单词</p>
                  </div>
                ) : (
                  vocabulary.map(v => (
                    <div key={v.addedAt} onClick={() => { setSelectedWord(v); setStage(AppStage.OCR_RESULT); setIsOpen(true); }}
                      className="p-3 bg-white/60 rounded-xl flex items-center justify-between cursor-pointer hover:bg-white border border-transparent hover:border-blue-100 transition-all">
                      <div className="flex-1"><p className="font-bold text-gray-800">{v.word}</p><p className="text-[10px] text-gray-400 truncate">{v.definitions[0]?.zh}</p></div>
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </div>
                  ))
                )}
              </div>
           </div>

           {/* Review Due List */}
           <div className="glass-morphism p-6 rounded-3xl shadow-xl border border-white flex flex-col">
              <h2 className="text-lg font-bold mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2"><History className="w-5 h-5 text-orange-500" /> 复习中心 ({dueCount})</span>
                <button onClick={() => { setIsOpen(true); setStage(AppStage.REVIEW_CENTER); }} className="text-xs text-orange-500 hover:underline">计划表</button>
              </h2>
              <div className="space-y-3 h-48 md:h-64 overflow-y-auto scrollbar-hide">
                {sessions.filter(s => s.nextReviewAt <= now).length === 0 ? (
                   <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50 space-y-2">
                    <CheckCircle className="w-8 h-8" />
                    <p className="text-sm italic">太棒了！目前没有待复习项</p>
                  </div>
                ) : (
                  sessions.filter(s => s.nextReviewAt <= now).map(s => (
                    <div key={s.id} onClick={() => { setCurrentSession(s); setStage(AppStage.COMPARISON); setIsOpen(true); }}
                      className="p-3 bg-orange-50/50 rounded-xl cursor-pointer hover:bg-white border border-orange-100 flex items-center justify-between group">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate text-sm">{s.extractedText}</p>
                        <div className="flex items-center gap-2 mt-1">
                           <span className="text-[9px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-bold">立即复习</span>
                           <span className="text-[9px] text-gray-400 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> 第 {s.reviewCount} 阶段</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-orange-300 group-hover:translate-x-1 transition-transform" />
                    </div>
                  ))
                )}
              </div>
           </div>
        </div>
      </div>

      {/* Floating Action Bar (Mobile Bottom / Desktop End) */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t md:bg-transparent md:border-t-0 md:static md:p-0 md:mb-10 safe-bottom z-40">
        <div className="max-w-4xl mx-auto flex justify-around md:justify-end gap-4">
          <button onClick={() => { setIsOpen(true); setStage(AppStage.CAPTURE); }}
            className="flex-1 md:flex-none md:w-16 md:h-16 bg-blue-600 text-white p-4 rounded-2xl md:rounded-full shadow-2xl flex items-center justify-center gap-2 md:gap-0 hover:scale-105 transition-all group">
            <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform" /><span className="md:hidden font-bold text-lg">捕获新灵感</span>
          </button>
        </div>
      </div>

      {/* Right-Side Modal Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="relative w-full md:max-w-lg bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            {/* Drawer Header */}
            <div className="p-4 md:p-6 border-b flex items-center justify-between sticky top-0 bg-white z-20">
              <h2 className="text-lg md:text-xl font-bold truncate flex items-center gap-2">
                {stage === AppStage.CAPTURE && "导入学习内容"}
                {stage === AppStage.OCR_RESULT && "智能解析"}
                {stage === AppStage.VOCABULARY && "词库管理"}
                {stage === AppStage.REVIEW_CENTER && "艾宾浩斯计划"}
                {stage === AppStage.WORD_PRACTICE && "深度造句"}
                {stage === AppStage.FEEDBACK && "反馈与建议"}
                {stage === AppStage.GOALS && "个性化设置"}
                {stage === AppStage.USER_THINKING && "翻译大挑战"}
                {stage === AppStage.COMPARISON && "AI 对比与总结"}
              </h2>
              <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X className="w-6 h-6 text-gray-400" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-hide space-y-6">
              {/* Capture Stage */}
              {stage === AppStage.CAPTURE && (
                <div className="grid gap-4 animate-in fade-in slide-in-from-bottom-2">
                  <button onClick={handleScreenCapture} className="flex items-center gap-4 p-5 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100 hover:bg-blue-100 transition-colors">
                    <Monitor /><p className="font-bold">捕获当前屏幕</p>
                  </button>
                  <label htmlFor="file-up" className="flex items-center gap-4 p-5 bg-purple-50 text-purple-700 rounded-2xl border border-purple-100 cursor-pointer hover:bg-purple-100 transition-colors">
                    <input type="file" id="file-up" className="hidden" accept="image/*" onChange={handleFileUpload} />
                    <Camera /><p className="font-bold">上传照片/截图</p>
                  </label>
                  <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100 space-y-4">
                    <textarea className="w-full p-4 rounded-xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 h-32 outline-none transition-all"
                      placeholder="或者直接在这里粘贴一段英文..." value={manualEnglishInput} onChange={(e) => setManualEnglishInput(e.target.value)} />
                    <button onClick={handleManualSubmit} disabled={!manualEnglishInput.trim()} className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold disabled:opacity-50 hover:bg-black transition-colors">开始深度学习</button>
                  </div>
                  {loading && (
                    <div className="text-center py-6 flex flex-col items-center gap-2">
                      <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                      <p className="text-sm font-medium text-gray-500">正在智能分析文本...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Setting Stage */}
              {stage === AppStage.GOALS && (
                <div className="space-y-8 animate-in slide-in-from-bottom-4">
                  <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 flex items-center gap-4">
                    <div className="p-3 bg-white rounded-2xl text-blue-600 shadow-sm"><Target className="w-8 h-8"/></div>
                    <div><p className="font-bold text-blue-900">设定你的学习节奏</p><p className="text-xs text-blue-700 opacity-70">合理的计划是成功的开始</p></div>
                  </div>
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <div className="flex justify-between px-1"><label className="text-sm font-bold text-gray-600">每日新词目标</label><span className="text-sm font-black text-blue-600">{goals.dailyNewWords} 个</span></div>
                      <input type="range" min="1" max="50" value={goals.dailyNewWords} onChange={(e) => setGoals({...goals, dailyNewWords: parseInt(e.target.value)})} className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between px-1"><label className="text-sm font-bold text-gray-600">每日复习目标</label><span className="text-sm font-black text-purple-600">{goals.dailyReviews} 个</span></div>
                      <input type="range" min="1" max="50" value={goals.dailyReviews} onChange={(e) => setGoals({...goals, dailyReviews: parseInt(e.target.value)})} className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-purple-600" />
                    </div>
                  </div>
                  <div className="pt-4 border-t space-y-4">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">通知设置</p>
                    <button onClick={toggleNotifications} className={`w-full flex items-center justify-between p-5 rounded-2xl border transition-all ${notificationsEnabled ? 'bg-green-50 border-green-200 text-green-700 shadow-sm' : 'bg-white border-gray-100 text-gray-500'}`}>
                      <div className="flex items-center gap-3">{notificationsEnabled ? <Bell className="w-5 h-5"/> : <BellOff className="w-5 h-5"/>}<p className="font-bold">系统提醒通知</p></div>
                      <span className="text-xs font-bold">{notificationsEnabled ? '已开启' : '点击开启'}</span>
                    </button>
                  </div>
                  <button onClick={() => setStage(AppStage.IDLE)} className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-black text-lg shadow-xl hover:bg-black transition-all">保存设置</button>
                </div>
              )}

              {/* Analysis Result Stage */}
              {stage === AppStage.OCR_RESULT && (
                <div className="animate-in fade-in space-y-6 pb-20">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">学习段落 (点击单词解析)</span>
                      <div className="flex gap-2">
                        <button onClick={() => isRecording ? stopRecording() : startRecording(currentSession.extractedText!)} className={`p-3 rounded-full transition-all shadow-md ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white text-gray-600 hover:bg-red-50'}`}><Mic className="w-5 h-5" /></button>
                        <button onClick={() => playTTS(currentSession.extractedText!)} className="p-3 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 transition-all"><Volume2 className="w-5 h-5" /></button>
                      </div>
                    </div>
                    <div className="p-6 bg-gray-900 text-white rounded-3xl text-xl leading-relaxed shadow-xl font-serif">{renderInteractiveText(currentSession.extractedText!, true)}</div>
                  </div>

                  {pronunciationResult && (
                    <div className="p-5 bg-purple-50 border border-purple-100 rounded-2xl animate-in slide-in-from-top-2 space-y-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-purple-900">读音评分</p>
                        <span className="text-2xl font-black text-purple-600">{pronunciationResult.score}</span>
                      </div>
                      <div className="bg-white/80 p-4 rounded-xl text-lg shadow-inner">{renderTranscriptionWithHighlights(pronunciationResult.transcription, pronunciationResult.corrections)}</div>
                      <p className="text-sm text-purple-800 font-medium leading-relaxed">{pronunciationResult.feedback}</p>
                    </div>
                  )}

                  {selectedWord && (
                    <div className="p-6 bg-white rounded-3xl border border-blue-100 space-y-5 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
                      <div className="absolute top-0 right-0 p-4"><Star className={`w-7 h-7 cursor-pointer transition-all ${isWordInVocab(selectedWord.word) ? 'fill-yellow-400 text-yellow-400 scale-125' : 'text-gray-200 hover:text-gray-300'}`} onClick={() => {
                        const cleanWord = selectedWord.word.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"");
                        if (isWordInVocab(cleanWord)) setVocabulary(v => v.filter(i => i.word.toLowerCase() !== cleanWord.toLowerCase()));
                        else setVocabulary([{...selectedWord, word: cleanWord, addedAt: Date.now()}, ...vocabulary]);
                      }} /></div>
                      <div>
                        <h3 className="text-3xl font-black text-blue-900 flex items-center gap-2">
                          {selectedWord.word}
                          <Volume2 className="w-5 h-5 text-blue-400 cursor-pointer hover:text-blue-600" onClick={() => playTTS(selectedWord.word)} />
                        </h3>
                        <p className="text-sm text-blue-400 mt-1 font-mono">/{selectedWord.phonetic}/</p>
                      </div>
                      <div className="space-y-3">
                        {selectedWord.definitions.map((d, i) => (
                          <div key={i} className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                            <p className="font-bold text-gray-800">{d.en}</p>
                            <p className="text-sm text-gray-500 mt-1">{d.zh}</p>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">AI 例句 (点击点词分析)</p>
                        {selectedWord.examples.map((e, i) => (
                          <div key={i} className="p-3 bg-blue-50/50 rounded-xl border border-blue-100/50">
                            <p className="text-blue-900 font-medium leading-relaxed">{renderInteractiveText(e.en)}</p>
                            <p className="text-xs text-blue-600 mt-1">{e.zh}</p>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setStage(AppStage.WORD_PRACTICE)} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg"><PencilLine className="w-5 h-5"/>进入造句挑战</button>
                    </div>
                  )}

                  {!loading && !selectedWord && (
                    <button onClick={() => setStage(AppStage.USER_THINKING)} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-xl hover:bg-blue-700 transition-all">下一步：翻译挑战之旅 <ChevronRight className="w-5 h-5" /></button>
                  )}
                </div>
              )}

              {/* Translation Challenge Stage */}
              {stage === AppStage.USER_THINKING && (
                <div className="space-y-6 animate-in slide-in-from-right-4">
                  <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100 shadow-inner"><p className="text-lg font-medium leading-relaxed text-blue-900">{currentSession.extractedText}</p></div>
                  <div className="relative">
                    <textarea className="w-full h-48 p-5 rounded-3xl ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-600 outline-none text-lg shadow-lg transition-all"
                      placeholder="试着翻译这段话，AI 会在后面为你批改..." value={userInput} onChange={e => setUserInput(e.target.value)} />
                    <div className="absolute bottom-4 right-4 text-xs font-bold text-gray-300">{userInput.length} 字</div>
                  </div>
                  <button onClick={async () => {
                    setLoading(true);
                    try {
                      const result = await compareTranslations(currentSession.extractedText!, userInput);
                      const final = {
                        ...currentSession, 
                        userTranslation: userInput, 
                        aiTranslation: result.aiTranslation, 
                        aiComparison: result.comparison,
                        createdAt: currentSession.createdAt || Date.now()
                      } as LearningSession;
                      setCurrentSession(final);
                      setStage(AppStage.COMPARISON);
                    } catch (err) { alert("AI 分析服务暂时不可用，请稍后再试"); } finally { setLoading(false); }
                  }} disabled={!userInput.trim() || loading} className="w-full bg-blue-600 text-white py-5 rounded-3xl font-bold shadow-xl flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="animate-spin" /> : <Send className="w-5 h-5"/>} 提交并比对
                  </button>
                </div>
              )}

              {/* Comparison & Finish Stage */}
              {stage === AppStage.COMPARISON && (
                <div className="space-y-8 pb-20 animate-in fade-in">
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">标准翻译参考</p>
                    <div className="p-6 bg-green-50 rounded-3xl border border-green-100 shadow-sm"><p className="text-xl font-bold text-green-900 leading-relaxed">{currentSession.aiTranslation}</p></div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">AI 点评与深度解析</p>
                    <div className="p-6 bg-white border border-gray-100 rounded-3xl whitespace-pre-wrap leading-relaxed shadow-sm text-gray-700">{currentSession.aiComparison}</div>
                  </div>
                  <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-4">
                    <Clock className="w-6 h-6 text-blue-600" />
                    <div>
                      <p className="text-sm font-bold text-blue-900">艾宾浩斯计划同步中</p>
                      <p className="text-[10px] text-blue-600">点击完成，系统将自动安排在 24 小时后提醒你第一次复习。</p>
                    </div>
                  </div>
                  <button onClick={handleFinishLearning} className="w-full bg-gray-900 text-white py-5 rounded-[2rem] font-black text-xl shadow-2xl hover:bg-black transition-all">完成学习</button>
                </div>
              )}

              {/* Vocabulary View Stage */}
              {stage === AppStage.VOCABULARY && (
                <div className="grid gap-4 pb-20 animate-in fade-in">
                   {vocabulary.length === 0 ? (
                      <div className="text-center py-20 opacity-30">
                        <ListMusic className="w-16 h-16 mx-auto mb-4" />
                        <p className="font-bold italic">词库是空的，快去捕获新单词吧</p>
                      </div>
                   ) : 
                    vocabulary.map(v => (
                      <div key={v.addedAt} className="p-5 bg-white rounded-3xl flex justify-between items-center shadow-sm border border-gray-100 hover:border-blue-200 transition-all group">
                        <div onClick={() => { setSelectedWord(v); setStage(AppStage.OCR_RESULT); }} className="cursor-pointer flex-1">
                          <p className="font-bold text-xl text-gray-900">{v.word}</p>
                          <p className="text-sm text-gray-500 mt-1 line-clamp-1">{v.definitions[0]?.zh}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => playTTS(v.word)} className="p-2 text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"><Volume2 className="w-5 h-5" /></button>
                          <button onClick={() => setVocabulary(vocabulary.filter(i => i.word !== v.word))} className="p-2 text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {/* Review Center Stage */}
              {stage === AppStage.REVIEW_CENTER && (
                <div className="space-y-6 pb-20 animate-in fade-in">
                  <div className="p-5 bg-orange-50 border border-orange-100 rounded-3xl flex items-center justify-between shadow-sm">
                    <div>
                      <p className="font-bold text-orange-900 text-lg">记忆轨迹计划表</p>
                      <p className="text-[10px] text-orange-700">目前共有 {sessions.length} 段学习记录</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                  {sessions.length === 0 ? (
                     <div className="text-center py-20 opacity-30">
                        <History className="w-16 h-16 mx-auto mb-4" />
                        <p className="font-bold italic">暂无复习计划</p>
                     </div>
                  ) : sessions.sort((a,b) => a.nextReviewAt - b.nextReviewAt).map(s => {
                    const isDue = s.nextReviewAt <= now;
                    return (
                      <div key={s.id} className={`p-5 rounded-3xl border transition-all ${isDue ? 'bg-white border-orange-300 shadow-md ring-1 ring-orange-200 ring-offset-2' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                         <div className="flex justify-between items-start mb-3">
                           <p className="font-bold text-gray-800 truncate flex-1 mr-4">{s.extractedText}</p>
                           {isDue && <span className="bg-orange-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full animate-bounce">DUE</span>}
                         </div>
                         <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <p className="text-[9px] text-gray-400 font-bold uppercase">复习进度: {s.reviewCount} / {EBBINGHAUS_INTERVALS.length}</p>
                              <p className="text-[9px] text-gray-500">{isDue ? "时间已到，请立即开始" : `预计在 ${new Date(s.nextReviewAt).toLocaleDateString()} 复习`}</p>
                            </div>
                            <button onClick={() => { setCurrentSession(s); setStage(AppStage.COMPARISON); }} className={`text-xs font-black p-2 px-6 rounded-xl transition-all ${isDue ? 'bg-orange-600 text-white shadow-lg hover:scale-105' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}>
                              {isDue ? '立即复习' : '预览回顾'}
                            </button>
                         </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}

              {/* Word Practice Stage */}
              {stage === AppStage.WORD_PRACTICE && selectedWord && (
                <div className="space-y-6 animate-in slide-in-from-bottom-4">
                  <button onClick={() => setStage(AppStage.OCR_RESULT)} className="flex items-center gap-1 text-blue-600 font-bold mb-4 hover:translate-x-[-4px] transition-transform"><ChevronLeft className="w-5 h-5"/>返回分析</button>
                  <div className="p-8 bg-gradient-to-br from-blue-900 to-indigo-900 text-white rounded-[2rem] text-center shadow-2xl relative overflow-hidden">
                    <div className="absolute top-[-10%] left-[-10%] w-32 h-32 bg-white/10 rounded-full blur-2xl" />
                    <p className="text-5xl font-black mb-2">{selectedWord.word}</p>
                    <p className="text-blue-300 font-mono italic opacity-70">/{selectedWord.phonetic}/</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">造句实验室</p>
                    <textarea className="w-full h-40 p-6 rounded-[2rem] ring-1 ring-gray-200 outline-none text-lg shadow-inner focus:ring-2 focus:ring-blue-500 transition-all"
                      placeholder={`用 "${selectedWord.word}" 试着造一个句子...`} value={practiceSentence} onChange={e => setPracticeSentence(e.target.value)} />
                  </div>
                  {practiceFeedback && (
                    <div className={`p-6 rounded-[2rem] border animate-in zoom-in-95 ${practiceFeedback.isCorrect ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'} shadow-sm`}>
                      <div className="flex items-center gap-2 mb-2">
                        {practiceFeedback.isCorrect ? <CheckCircle className="w-6 h-6 text-green-500" /> : <AlertCircle className="w-6 h-6 text-red-500" />}
                        <p className="font-black text-lg">{practiceFeedback.isCorrect ? "精准无误！" : "优化建议"}</p>
                      </div>
                      <p className="text-sm font-medium leading-relaxed mb-3 opacity-80">{practiceFeedback.feedback}</p>
                      <div className="p-4 bg-white/60 rounded-2xl border border-white">
                        <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase">推荐优化版本</p>
                        <p className="font-serif italic text-lg">{practiceFeedback.suggestion}</p>
                      </div>
                    </div>
                  )}
                  <button onClick={handlePracticeSubmit} disabled={!practiceSentence.trim() || loading} className="w-full bg-blue-600 text-white py-5 rounded-[2rem] font-black text-xl shadow-xl flex items-center justify-center gap-2 hover:bg-blue-700 transition-all">
                    {loading ? <Loader2 className="animate-spin" /> : "AI 智能批改"}
                  </button>
                </div>
              )}

              {/* Feedback Stage */}
              {stage === AppStage.FEEDBACK && (
                <div className="space-y-6">
                  {feedbackSuccess ? (
                    <div className="text-center py-20 animate-in zoom-in">
                      <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 animate-bounce" />
                      </div>
                      <h3 className="text-2xl font-black text-gray-900 mb-2">感谢您的反馈！</h3>
                      <p className="text-gray-500">我们会不断优化产品体验</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        {(['SUGGESTION', 'BUG', 'OTHER'] as const).map(cat => (
                          <button key={cat} onClick={() => setFeedbackCategory(cat)} className={`flex-1 py-4 rounded-2xl font-bold border transition-all ${feedbackCategory === cat ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-105' : 'bg-white border-gray-100 text-gray-400 hover:border-blue-200'}`}>{cat === 'BUG' ? '反馈错误' : cat === 'SUGGESTION' ? '功能建议' : '其他'}</button>
                        ))}
                      </div>
                      <textarea className="w-full h-48 p-6 rounded-[2rem] border border-gray-100 outline-none focus:ring-2 focus:ring-blue-600 shadow-inner text-lg" placeholder="有什么想对我们说的吗？" value={feedbackText} onChange={e => setFeedbackText(e.target.value)} />
                      <button onClick={handleFeedbackSubmit} disabled={!feedbackText.trim()} className="w-full bg-gray-900 text-white py-5 rounded-[2rem] font-black text-xl shadow-xl hover:bg-black transition-all">发送反馈</button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Sticky Mobile Navigation Drawer Footnote */}
            <div className="p-4 border-t bg-white flex items-center justify-around safe-bottom">
               <button onClick={() => setStage(AppStage.CAPTURE)} className={`flex flex-col items-center gap-1 transition-all ${stage === AppStage.CAPTURE ? 'text-blue-600 scale-110' : 'text-gray-400 hover:text-gray-600'}`}><Camera className="w-5 h-5"/><span className="text-[10px] font-bold">学习</span></button>
               <button onClick={() => setStage(AppStage.VOCABULARY)} className={`flex flex-col items-center gap-1 transition-all ${stage === AppStage.VOCABULARY ? 'text-blue-600 scale-110' : 'text-gray-400 hover:text-gray-600'}`}><BookOpen className="w-5 h-5"/><span className="text-[10px] font-bold">词库</span></button>
               <button onClick={() => setStage(AppStage.REVIEW_CENTER)} className={`flex flex-col items-center gap-1 transition-all relative ${stage === AppStage.REVIEW_CENTER ? 'text-orange-600 scale-110' : 'text-gray-400 hover:text-gray-600'}`}>
                  <BrainCircuit className="w-5 h-5"/>
                  <span className="text-[10px] font-bold">复习</span>
                  {dueCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-600 text-white text-[8px] flex items-center justify-center rounded-full font-bold shadow-sm border-2 border-white animate-pulse">
                      {dueCount}
                    </span>
                  )}
               </button>
               <button onClick={() => setStage(AppStage.GOALS)} className={`flex flex-col items-center gap-1 transition-all ${stage === AppStage.GOALS ? 'text-blue-600 scale-110' : 'text-gray-400 hover:text-gray-600'}`}><Target className="w-5 h-5"/><span className="text-[10px] font-bold">目标</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
