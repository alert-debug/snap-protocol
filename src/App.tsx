import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { createDeck, shuffleDeck, generateCommitment, Card } from './gameUtils';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, Users, Play, RefreshCw, AlertCircle, CheckCircle2, Hash, Activity, MessageSquare, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

type GameState = 'IDLE' | 'CONNECTING' | 'COMMITTING' | 'REVEALING' | 'PLAYING' | 'GAME_OVER';

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'peer';
};

// --- COMPONENTS ---

const PlayingCard = ({ card, isFlipped = true, count = 0 }: { card?: Card; isFlipped?: boolean; count?: number }) => {
  if (!isFlipped) {
    return (
      <div 
        className="border-2 border-zinc-800 rounded-xl flex items-center justify-center shadow-xl overflow-hidden relative group"
        style={{ 
          width: '112px', 
          height: '160px', 
          backgroundColor: '#991b1b', // Red-800
          backgroundImage: 'radial-gradient(#7f1d1d 1px, transparent 1px)',
          backgroundSize: '8px 8px'
        }}
      >
        <div className="absolute inset-0 opacity-20 group-hover:opacity-30 transition-opacity" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fff, #fff 10px, transparent 10px, transparent 20px)' }} />
        <div className="flex flex-col items-center gap-1 relative z-10">
          <span className="text-3xl font-black text-white/20">{count}</span>
        </div>
        <div className="absolute inset-2 border border-white/10 rounded-lg pointer-events-none" />
      </div>
    );
  }

  if (!card) return null;

  const isRed = ['♥', '♦'].includes(card.suit);
  const color = isRed ? '#ef4444' : '#09090b'; // Red-500 or Zinc-950

  return (
    <div 
      className="rounded-xl shadow-2xl flex flex-col items-center justify-between p-3 border-2 border-zinc-200 relative overflow-hidden"
      style={{ width: '112px', height: '160px', backgroundColor: 'white' }}
    >
      {/* Top Left Corner */}
      <div className="self-start flex flex-col items-center leading-none" style={{ color }}>
        <span className="text-lg font-black">{card.value}</span>
        <span className="text-xs">{card.suit}</span>
      </div>

      {/* Center Symbol */}
      <div className="text-6xl" style={{ color }}>
        {card.suit}
      </div>

      {/* Bottom Right Corner (Inverted) */}
      <div className="self-end flex flex-col items-center leading-none rotate-180" style={{ color }}>
        <span className="text-lg font-black">{card.value}</span>
        <span className="text-xs">{card.suit}</span>
      </div>
      
      {/* Card Shine */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/40 via-transparent to-black/5 pointer-events-none" />
    </div>
  );
};

export default function App() {
  const [peerId, setPeerId] = useState<string>('');
  const [remotePeerId, setRemotePeerId] = useState<string>('');
  const [gameState, setGameState] = useState<GameState>('IDLE');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [myCommitment, setMyCommitment] = useState<{ seed: string; hash: string } | null>(null);
  const [remoteHash, setRemoteHash] = useState<string | null>(null);
  const [remoteSeed, setRemoteSeed] = useState<string | null>(null);
  const [piles, setPiles] = useState<{ [key: string]: Card[] }>({});
  const [centerPile, setCenterPile] = useState<Card[]>([]);
  const [turn, setTurn] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [isLogExpanded, setIsLogExpanded] = useState(true);
  const [winner, setWinner] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Refs to avoid closure staleness in PeerJS callbacks
  const stateRef = useRef<GameState>('IDLE');
  const pilesRef = useRef<{ [key: string]: Card[] }>({});
  const remotePeerIdRef = useRef<string>('');
  const peerIdRef = useRef<string>('');
  const centerPileRef = useRef<Card[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Sync refs with state
  useEffect(() => { stateRef.current = gameState; }, [gameState]);
  useEffect(() => { pilesRef.current = piles; }, [piles]);
  useEffect(() => { remotePeerIdRef.current = remotePeerId; }, [remotePeerId]);
  useEffect(() => { peerIdRef.current = peerId; }, [peerId]);
  useEffect(() => { centerPileRef.current = centerPile; }, [centerPile]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => {
      const newLogs = (prev || []).concat([{
        timestamp: new Date().toLocaleTimeString(),
        message: message,
        type: type
      }]);
      return newLogs.slice(-50);
    });
  }, []);

  const resetGame = useCallback(() => {
    setGameState('IDLE');
    setMyCommitment(null);
    setRemoteHash(null);
    setRemoteSeed(null);
    setPiles({});
    setCenterPile([]);
    setTurn('');
    setWinner(null);
    addLog('Game state reset.', 'info');
  }, [addLog]);

  const handleRemotePlay = useCallback((card: Card) => {
    const rId = remotePeerIdRef.current;
    if (!rId) return;

    setPiles(prev => {
      const peerPile = prev ? prev[rId] : null;
      if (!peerPile || peerPile.length === 0) return prev;
      const nextPiles = { ...prev };
      nextPiles[rId] = peerPile.slice(1);
      return nextPiles;
    });

    setCenterPile(prev => (prev || []).concat([card]));
    setTurn(peerIdRef.current);
    addLog('Peer played: ' + card.value + card.suit, 'peer');
  }, [addLog]);

  const handleRemoteSnap = useCallback((remoteTimestamp: number) => {
    const rId = remotePeerIdRef.current;
    const currentCenter = centerPileRef.current || [];
    if (!rId || currentCenter.length < 2) return;

    const last = currentCenter[currentCenter.length - 1];
    const secondLast = currentCenter[currentCenter.length - 2];
    
    if (last && secondLast && last.value === secondLast.value) {
      addLog('Peer SNAPPED correctly!', 'error');
      setPiles(prev => {
        const nextPiles = { ...prev };
        nextPiles[rId] = (prev[rId] || []).concat(currentCenter);
        return nextPiles;
      });
      setCenterPile([]);
    } else {
      addLog('Peer attempted a false snap.', 'info');
    }
  }, [addLog]);

  const handleData = useCallback((data: any) => {
    if (!data || !data.type) return;
    addLog('Incoming: ' + data.type, 'peer');
    
    switch (data.type) {
      case 'COMMIT': setRemoteHash(data.hash); break;
      case 'REVEAL': setRemoteSeed(data.seed); break;
      case 'PLAY_CARD': handleRemotePlay(data.card); break;
      case 'SNAP': handleRemoteSnap(data.timestamp); break;
      case 'GAME_OVER': 
        setGameState('GAME_OVER');
        setWinner(data.winner);
        addLog('Game Over! Winner: ' + (data.winner === peerId ? 'YOU' : 'PEER'), 'success');
        break;
    }
  }, [addLog, handleRemotePlay, handleRemoteSnap]);

  const setupConnection = useCallback((conn: DataConnection) => {
    if (connRef.current) connRef.current.close();
    connRef.current = conn;
    setRemotePeerId(conn.peer);
    setGameState('CONNECTING');

    conn.on('open', () => {
      addLog('Connection established with ' + conn.peer, 'success');
      setGameState('COMMITTING');
      const commitment = generateCommitment();
      setMyCommitment(commitment);
      conn.send({ type: 'COMMIT', hash: commitment.hash });
    });

    conn.on('data', (data) => handleData(data));
    conn.on('close', () => { addLog('Peer disconnected.', 'error'); resetGame(); });
    conn.on('error', (err) => addLog('Connection error: ' + err.message, 'error'));
  }, [addLog, handleData, resetGame]);

  const connectToPeer = () => {
    if (!remotePeerId || !peerRef.current) return;
    const conn = peerRef.current.connect(remotePeerId);
    setIsHost(false);
    setupConnection(conn);
  };

  const playCard = () => {
    if (gameState !== 'PLAYING' || turn !== peerId) return;
    
    const myPile = piles[peerId] || [];
    const opponentPile = piles[remotePeerId] || [];

    // Win condition check
    if (myPile.length > 0 && opponentPile.length === 0) {
      setGameState('GAME_OVER');
      setWinner(peerId);
      if (connRef.current) connRef.current.send({ type: 'GAME_OVER', winner: peerId });
      addLog('You claimed victory!', 'success');
      return;
    }

    if (myPile.length === 0) return;
    
    const card = myPile[0];
    setPiles(prev => {
      const next = { ...prev };
      next[peerId] = myPile.slice(1);
      return next;
    });
    setCenterPile(prev => (prev || []).concat([card]));
    setTurn(remotePeerId);
    if (connRef.current) connRef.current.send({ type: 'PLAY_CARD', card: card });
  };

  const snap = () => {
    if (gameState !== 'PLAYING' || centerPile.length < 2) return;
    const last = centerPile[centerPile.length - 1];
    const secondLast = centerPile[centerPile.length - 2];
    const isMatch = last && secondLast && last.value === secondLast.value;
    if (connRef.current) connRef.current.send({ type: 'SNAP', timestamp: Date.now() });
    if (isMatch) {
      addLog('SNAP! You win!', 'success');
      setPiles(prev => {
        const next = { ...prev };
        next[peerId] = (prev[peerId] || []).concat(centerPile);
        return next;
      });
      setCenterPile([]);
    } else {
      addLog('False Snap!', 'error');
      const myPile = piles[peerId];
      if (myPile && myPile.length > 0) {
        const penalty = myPile[0];
        setPiles(prev => {
          const next = { ...prev };
          next[peerId] = myPile.slice(1);
          return next;
        });
        setCenterPile(prev => [penalty].concat(prev || []));
      }
    }
  };

  useEffect(() => {
    const peer = new Peer();
    peerRef.current = peer;
    peer.on('open', (id) => { setPeerId(id); addLog('Network ready. ID: ' + id, 'success'); });
    peer.on('connection', (conn) => { setIsHost(true); setupConnection(conn); });
    peer.on('error', (err) => addLog('Network error: ' + err.message, 'error'));
    return () => { if (peerRef.current) peerRef.current.destroy(); };
  }, [addLog, setupConnection]);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (myCommitment && remoteHash && gameState === 'COMMITTING') {
      setGameState('REVEALING');
      if (connRef.current) connRef.current.send({ type: 'REVEAL', seed: myCommitment.seed });
    }
  }, [myCommitment, remoteHash, gameState]);

  useEffect(() => {
    if (myCommitment && remoteSeed && gameState === 'REVEALING') {
      const combinedSeed = [myCommitment.seed, remoteSeed].sort().join('-');
      const initialDeck = createDeck();
      const shuffled = shuffleDeck(initialDeck, combinedSeed);
      const hostId = isHost ? peerId : remotePeerId;
      const guestId = isHost ? remotePeerId : peerId;
      const newPiles: { [key: string]: Card[] } = {};
      newPiles[hostId] = shuffled.slice(0, 26);
      newPiles[guestId] = shuffled.slice(26);
      setPiles(newPiles);
      setTurn(hostId);
      setGameState('PLAYING');
      setIsLogExpanded(false);
      addLog('Game start!', 'success');
    }
  }, [myCommitment, remoteSeed, gameState, isHost, peerId, remotePeerId, addLog]);

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono flex flex-col overflow-hidden relative">

      {/* --- GAME AREA (TOP) --- */}
      <div className="flex-1 flex flex-col p-4 md:p-8 relative overflow-hidden">
        {/* Table Background (Green Baize) */}
        <div className="absolute inset-0 bg-[#064e3b] pointer-events-none" />
        <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ 
          backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.15) 0%, transparent 80%), url("https://www.transparenttextures.com/patterns/felt.png")',
          backgroundBlendMode: 'overlay'
        }} />
        <div className="absolute inset-0 border-[24px] border-[#042f24] pointer-events-none opacity-50" />

        {/* Header Overlay */}
        <div className="flex justify-between items-center mb-8 z-10">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-zinc-900 border border-zinc-800 ${gameState === 'CONNECTING' ? 'animate-spin' : ''}`}>
              <RefreshCw className="w-5 h-5 text-emerald-500" />
            </div>
            <h1 className="text-xl font-black tracking-tighter uppercase italic">Snap_Protocol</h1>
          </div>
          <div className="flex gap-2">
            {gameState === 'IDLE' ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="REMOTE_ID"
                  className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 w-40"
                  value={remotePeerId}
                  onChange={(e) => setRemotePeerId(e.target.value)}
                />
                <button onClick={connectToPeer} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2">
                  <Play className="w-3 h-3 fill-current" /> CONNECT
                </button>
              </div>
            ) : (
              <button onClick={resetGame} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-1.5 rounded-md text-xs font-bold">RESET</button>
            )}
          </div>
        </div>

        {/* The Board */}
        <div className="flex-1 flex flex-col items-center justify-center gap-12 z-10">
          {gameState === 'GAME_OVER' ? (
            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center gap-6"
            >
              <div className={`text-6xl font-black italic tracking-tighter uppercase ${winner === peerId ? 'text-emerald-500' : 'text-red-500'}`}>
                {winner === peerId ? 'YOU WIN' : 'YOU LOSE'}
              </div>
              <button 
                onClick={resetGame}
                className="bg-zinc-100 text-zinc-950 px-8 py-3 rounded-full font-black uppercase tracking-widest hover:bg-white transition-all hover:scale-110 active:scale-95"
              >
                Play Again
              </button>
            </motion.div>
          ) : gameState === 'PLAYING' ? (
            <>
              {/* Opponent Hand */}
              <div className="flex flex-col items-center gap-2">
                <PlayingCard isFlipped={false} count={piles[remotePeerId]?.length || 0} />
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Opponent_Deck</span>
              </div>

              {/* Center Pile */}
              <div 
                className="relative flex items-center justify-center"
                style={{ width: '112px', height: '160px' }}
              >
                <AnimatePresence mode="popLayout">
                  {centerPile && centerPile.length > 0 ? (
                    <motion.div
                      key={centerPile.length}
                      initial={{ scale: 2, opacity: 0, y: -100 }}
                      animate={{ scale: 1, opacity: 1, y: 0, rotate: (centerPile.length * 13) % 40 - 20 }}
                      className="absolute inset-0"
                    >
                      <PlayingCard card={centerPile[centerPile.length - 1]} />
                    </motion.div>
                  ) : (
                    <div className="w-full h-full border-2 border-dashed border-white/20 rounded-2xl flex items-center justify-center text-white/30 text-[10px] text-center p-4 uppercase tracking-tighter">
                      Waiting_For_Play
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Player Actions */}
              <div className="flex items-center gap-12">
                <button
                  onClick={playCard}
                  disabled={turn !== peerId || (piles[peerId]?.length === 0 && piles[remotePeerId]?.length > 0)}
                  className={`w-28 h-28 rounded-full border-8 flex items-center justify-center text-xl font-black transition-all ${
                    turn === peerId
                      ? (piles[peerId]?.length > 0 && piles[remotePeerId]?.length === 0)
                        ? 'bg-yellow-500 border-yellow-300 text-black hover:scale-110 active:scale-95 shadow-[0_0_30px_rgba(234,179,8,0.5)]'
                        : 'bg-emerald-600 border-emerald-400 text-white hover:scale-110 active:scale-95 shadow-[0_0_30px_rgba(16,185,129,0.3)]'
                      : 'bg-zinc-900/50 border-white/10 text-white/20 opacity-40'
                  }`}
                >
                  {piles[peerId]?.length > 0 && piles[remotePeerId]?.length === 0 ? 'WIN' : 'DEAL'}
                </button>

                <div className="flex flex-col items-center gap-2">
                  <button
                    disabled={turn !== peerId || piles[peerId]?.length === 0}
                    onClick={playCard}
                    className={`transition-all ${
                      turn === peerId && piles[peerId]?.length > 0
                        ? 'hover:scale-110 active:scale-95' 
                        : ''
                    }`}
                  >
                    <PlayingCard isFlipped={false} count={piles[peerId]?.length || 0} />
                  </button>
                  <span className={`text-[10px] uppercase tracking-widest font-bold ${turn === peerId && piles[peerId]?.length > 0 ? 'text-emerald-500 animate-pulse' : 'text-zinc-500'}`}>
                    {turn === peerId && piles[peerId]?.length > 0 ? 'Your_Turn' : 'Your_Deck'}
                  </span>
                </div>

                <button
                  onClick={snap}
                  disabled={centerPile.length < 2}
                  className={`w-28 h-28 rounded-full border-8 flex items-center justify-center text-xl font-black transition-all ${
                    centerPile.length >= 2
                      ? 'bg-red-600 border-red-400 text-white hover:scale-125 active:scale-90 shadow-[0_0_50px_rgba(220,38,38,0.5)]'
                      : 'bg-zinc-900/50 border-white/10 text-white/20 opacity-40'
                  }`}
                >
                  SNAP!
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 text-zinc-600">
              <div className="w-16 h-16 rounded-full border-2 border-zinc-800 flex items-center justify-center animate-pulse">
                <Activity className="w-8 h-8" />
              </div>
              <p className="text-sm uppercase tracking-[0.2em] font-bold italic">Protocol_Standby</p>
            </div>
          )}
        </div>
      </div>


      {/* --- DEBUG AREA (BOTTOM) --- */}
      <div className="h-1/3 bg-zinc-900 border-t border-zinc-800 grid grid-cols-1 md:grid-cols-4 divide-x divide-zinc-800 overflow-hidden">
        
        {/* Column 1: Network */}
        <div className="p-4 flex flex-col gap-3 min-w-0">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
            <Users className="w-3 h-3" /> Network_Stack
          </h2>
          <div className="space-y-2 text-[10px]">
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800 group relative">
              <p className="text-zinc-600 mb-1">LOCAL_PEER_ID</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-emerald-400 truncate select-text">{peerId || 'INITIALIZING...'}</p>
                {peerId && (
                  <button 
                    onClick={() => copyToClipboard(peerId)}
                    className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-500 hover:text-emerald-400"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                )}
              </div>
            </div>
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
              <p className="text-zinc-600 mb-1">REMOTE_PEER_ID</p>
              <p className="text-blue-400 truncate">{remotePeerId || 'DISCONNECTED'}</p>
            </div>
            <div className="flex justify-between px-1">
              <span className="text-zinc-600">ROLE</span>
              <span className="text-zinc-300">{isHost ? 'HOST' : 'GUEST'}</span>
            </div>
          </div>
        </div>

        {/* Column 2: Pre-Commit Process */}
        <div className="p-4 flex flex-col gap-3 min-w-0">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
            <Hash className="w-3 h-3" /> Fair_Deck_Protocol
          </h2>
          <div className="space-y-2 text-[10px]">
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
              <p className="text-zinc-600 mb-1">LOCAL_COMMITMENT</p>
              <p className="truncate text-zinc-400">{myCommitment?.hash || 'PENDING'}</p>
            </div>
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
              <p className="text-zinc-600 mb-1">REMOTE_COMMITMENT</p>
              <p className="truncate text-zinc-400">{remoteHash || 'PENDING'}</p>
            </div>
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800">
              <p className="text-zinc-600 mb-1">REVEALED_SEEDS</p>
              <p className="text-zinc-400 truncate">L: {myCommitment?.seed || '-'} | R: {remoteSeed || '-'}</p>
            </div>
          </div>
        </div>

        {/* Column 3: Game Logic State */}
        <div className="p-4 flex flex-col gap-3 min-w-0">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
            <Activity className="w-3 h-3" /> Logic_Engine
          </h2>
          <div className="space-y-2 text-[10px]">
            <div className="flex justify-between items-center bg-zinc-950 p-2 rounded border border-zinc-800">
              <span className="text-zinc-600">STATE</span>
              <span className="text-emerald-400 font-bold">{gameState}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-950 p-2 rounded border border-zinc-800 text-center">
                <p className="text-zinc-600 mb-1">YOU</p>
                <p className="text-lg font-bold">{piles[peerId]?.length || 0}</p>
              </div>
              <div className="bg-zinc-950 p-2 rounded border border-zinc-800 text-center">
                <p className="text-zinc-600 mb-1">PEER</p>
                <p className="text-lg font-bold">{piles[remotePeerId]?.length || 0}</p>
              </div>
            </div>
            <div className="bg-zinc-950 p-2 rounded border border-zinc-800 flex justify-between">
              <span className="text-zinc-600">TURN_OWNER</span>
              <span className={turn === peerId ? 'text-emerald-400' : 'text-zinc-400'}>{turn === peerId ? 'LOCAL' : turn ? 'REMOTE' : 'NONE'}</span>
            </div>
          </div>
        </div>

        {/* Column 4: System Logs */}
        <div className={`p-4 flex flex-col gap-3 min-w-0 transition-all duration-300 ${isLogExpanded ? 'md:col-span-1' : 'md:w-12 md:flex-none md:p-2'}`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2 ${!isLogExpanded && 'md:hidden'}`}>
              <MessageSquare className="w-3 h-3" /> System_Log
            </h2>
            <button 
              onClick={() => setIsLogExpanded(!isLogExpanded)}
              className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-500 hover:text-emerald-400"
              title={isLogExpanded ? "Collapse Log" : "Expand Log"}
            >
              {isLogExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          </div>
          
          {isLogExpanded && (
            <div className="flex-1 bg-zinc-950 rounded border border-zinc-800 overflow-y-auto p-2 space-y-1 text-[9px] font-mono leading-tight">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-zinc-700 shrink-0">{log.timestamp.split(' ')[0]}</span>
                  <span className={
                    log.type === 'error' ? 'text-red-500' :
                    log.type === 'success' ? 'text-emerald-500' :
                    log.type === 'peer' ? 'text-blue-500' :
                    'text-zinc-500'
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
