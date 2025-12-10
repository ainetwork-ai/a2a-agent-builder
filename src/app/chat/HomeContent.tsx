'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { A2AClient } from "@a2a-js/sdk/client";
import { AgentCard, SendMessageSuccessResponse } from "@a2a-js/sdk";
import { Message, MessageSendParams, TextPart } from "@a2a-js/sdk";
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Archive, Send } from 'lucide-react';
import { safeFetch } from '@/lib/utils/safeFetch';

const DEFAULT_AGENT_ID = 'socrates-web3-tutor';
const A2A_API_PREFIX = "/api/agents";

export default function HomeContent() {
  const searchParams = useSearchParams();
  const agentUrl = searchParams.get('agentUrl');
  const [history, setHistory] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<A2AClient | null>(null);
  const [agentName, setAgentName] = useState<string>('Loading...');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [thinkingFacts, setThinkingFacts] = useState<string[]>([]);
  const [caringFacts, setCaringFacts] = useState<string[]>([]);
  const [currentIntent, setCurrentIntent] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  // 대화 세션 동안 유지되는 contextId 생성
  const [contextId] = useState<string>(uuidv4());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load username from localStorage on mount
  useEffect(() => {
    const savedUsername = localStorage.getItem('a2a-username');
    if (savedUsername) {
      setUsername(savedUsername);
      console.log('✅ Username loaded from localStorage:', savedUsername);
    } else {
      setShowUsernameModal(true);
      console.log('⚠️ No username found - showing modal');
    }
  }, []);

  // A2A 클라이언트 초기화
  useEffect(() => {
    const initializeClient = async () => {
      try {
        let cardUrl: string;
        if (agentUrl) {
          // Use the provided agent URL
          cardUrl = `${agentUrl}/.well-known/agent.json`;
          console.log('🔍 Initializing A2A client with custom agent:', cardUrl);
        } else {
          // Use default agent
          cardUrl = `${window.location.origin}${A2A_API_PREFIX}/${DEFAULT_AGENT_ID}/.well-known/agent.json`;
          console.log('🔍 Initializing A2A client with default agent:', cardUrl);
        }

        // First check if the agent card is accessible
        console.log('📡 Fetching agent card...');
        const card = await safeFetch<AgentCard>(cardUrl);
        console.log('✅ Agent card loaded:', card.name);
        setAgentName(card.name || 'Unknown Agent');

        // Extract agentId from URL
        let extractedAgentId: string;
        if (agentUrl) {
          extractedAgentId = agentUrl.split('/').pop() || DEFAULT_AGENT_ID;
        } else {
          extractedAgentId = DEFAULT_AGENT_ID;
        }
        setAgentId(extractedAgentId);

        // URL로부터 에이전트 카드 정보를 읽어와 클라이언트 생성
        console.log('🤖 Creating A2A client...');
        const a2aClient = await A2AClient.fromCardUrl(cardUrl);
        setClient(a2aClient);
        console.log('✅ A2A client initialized successfully');
      } catch (err) {
        console.error("❌ Failed to initialize A2A client:", err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(`에이전트 연결 실패: ${errorMessage}`);
      }
    };
    initializeClient();
  }, [agentUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // Fetch agent status helper - can optionally override intent
  const fetchStatus = useCallback(async (intentOverride?: string) => {
    if (!agentId) return;

    const effectiveIntent = intentOverride ?? currentIntent;
    console.log('🔍 Fetching status with:', { agentId, effectiveIntent, username });

    try {
      const baseUrl = agentUrl
        ? agentUrl.split('/api/agents/')[0]
        : window.location.origin;

      const params = new URLSearchParams();
      if (effectiveIntent) params.append('intent', effectiveIntent);
      if (username) params.append('username', username);

      const statusUrl = `${baseUrl}/api/agents/${agentId}/status?${params.toString()}`;

      const data = await safeFetch(statusUrl);
      console.log('✅ Status fetched:', data);

      // Update thinking facts
      if (data.thinking?.facts) {
        setThinkingFacts(data.thinking.facts);
      } else {
        setThinkingFacts([]);
      }

      // Update caring facts
      if (data.caring?.facts) {
        setCaringFacts(data.caring.facts);
      } else {
        setCaringFacts([]);
      }
    } catch (err) {
      console.error('Failed to fetch agent status:', err);
    }
  }, [agentId, agentUrl, currentIntent, username]);

  // Update memory after conversation
  const updateMemory = async (conversationHistory: Message[], intent?: string) => {
    if (!agentId) return;

    try {
      const updateUrl = agentUrl
        ? `${agentUrl.split('/api/agents/')[0]}/api/agents/${agentId}/update-memory`
        : `${window.location.origin}/api/agents/${agentId}/update-memory`;

      console.log('🔄 Updating memory...', intent ? `(intent: ${intent})` : '', username ? `(user: ${username})` : '');
      const data = await safeFetch(updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextId,
          conversationHistory,
          intent, // Pass pre-classified intent to avoid re-classification
          username // Pass username for caring memory
        })
      });
      console.log('✅ Memory updated:', data);

      // Fetch updated status to get new thinking facts
      await fetchStatus();
    } catch (err) {
      console.error('Failed to update memory:', err);
    }
  };

  // Fetch status when intent or username changes
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !client) return;

    const userMessage: Message = {
        kind: "message",
        messageId: uuidv4(),
        role: "user",
        parts: [{ kind: "text", text: input }],
        contextId: contextId, // 중요: 유지된 contextId 사용
    };

    // UI 업데이트
    setHistory(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const sendParams: MessageSendParams = {
        message: userMessage,
      };

      // A2A 클라이언트로 메시지 전송 (SDK가 폴링 및 응답 처리 자동화)
      const response = await client.sendMessage(sendParams);

      if ("error" in response) {
        throw new Error(response.error.message);
      }

      const resultEvent = (response as SendMessageSuccessResponse).result;

      if (isMessage(resultEvent)) {
          // Extract intent from response metadata if available
          const messageWithMetadata = resultEvent as Message & { metadata?: { intent?: string } };
          const intent = messageWithMetadata.metadata?.intent;
          console.log('📨 Agent response:', {
            hasMetadata: !!messageWithMetadata.metadata,
            intent,
            fullMetadata: messageWithMetadata.metadata
          });

          if (intent) {
            console.log('✅ Setting intent:', intent);
            setCurrentIntent(intent);
            // Immediately fetch status with the new intent
            fetchStatus(intent);
          } else {
            console.log('⚠️ No intent in response metadata');
          }

          // 에이전트 응답으로 UI 업데이트
          setHistory(prev => {
            const updatedHistory = [...prev, resultEvent];

            // Update memory in background with full history and intent
            updateMemory(updatedHistory, intent);
            return updatedHistory;
          });
      }

      // Message 타입 판별 함수 (로컬 구현)
      function isMessage(obj: unknown): obj is Message {
        return Boolean(obj && typeof obj === "object" && obj !== null &&
               'kind' in obj && (obj as Record<string, unknown>).kind === "message" &&
               'messageId' in obj && typeof (obj as Record<string, unknown>).messageId === "string");
      }

    } catch (error: unknown) {
      console.error('A2A communication error:', error);
      setError(`통신 오류: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessageContent = (message: Message) => {
    return message.parts
      .filter((part): part is TextPart => part.kind === 'text')
      .map((part, index) => <span key={index}>{part.text}</span>);
  };

  // Handle username setup
  const handleUsernameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;

    const trimmedUsername = usernameInput.trim();
    setUsername(trimmedUsername);
    localStorage.setItem('a2a-username', trimmedUsername);
    setShowUsernameModal(false);
    console.log('✅ Username saved:', trimmedUsername);
  };

  // --- Rendering ---
  if (error && !client) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-white/90 backdrop-blur-sm p-12 rounded-2xl shadow-xl border border-red-200 text-center">
          <div className="text-6xl mb-4">❌</div>
          <p className="text-red-500 text-lg font-semibold mb-2">Initialization Error</p>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-white/90 backdrop-blur-sm p-12 rounded-2xl shadow-xl border border-purple-100 text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent mb-4"></div>
          <p className="text-gray-600">Connecting to A2A agent...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 overflow-hidden flex flex-col" style={{ height: '100dvh' }}>
      {/* Username Setup Modal */}
      {showUsernameModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 border-2 border-purple-200">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">👤</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome!</h2>
              <p className="text-gray-600">Please set your username to start chatting</p>
            </div>
            <form onSubmit={handleUsernameSubmit}>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full p-4 text-lg border-2 border-gray-200 rounded-xl focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 transition-all duration-200 mb-4"
                placeholder="Enter your username..."
                autoFocus
              />
              <button
                type="submit"
                className="w-full px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl shadow-lg transition-[box-shadow,transform] duration-200 active:scale-95 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:active:scale-100 md:hover:from-purple-700 md:hover:to-blue-700 md:hover:shadow-xl md:hover:-translate-y-0.5"
                disabled={!usernameInput.trim()}
              >
                Start Chatting
              </button>
            </form>
            <p className="text-xs text-gray-500 text-center mt-4">
              This will be saved locally and used for personalized interactions
            </p>
          </div>
        </div>
      )}

      {/* Navigation Bar */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-purple-100 shadow-sm flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2 sm:gap-3 group min-w-0 flex-shrink">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
              <span className="text-white text-lg sm:text-xl font-bold">🏠</span>
            </div>
            <span className="font-bold text-sm sm:text-base text-gray-700 group-hover:text-purple-600 transition-colors truncate">Home</span>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <div className="flex items-center gap-2 px-2 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg h-[30px] sm:h-[40px]">
              <span className="text-xs sm:text-sm font-semibold text-purple-700 truncate max-w-[120px] sm:max-w-none">{agentName}</span>
            </div>
            <Link
              href="/builder"
              className="px-2.5 sm:px-4 h-[30px] sm:h-[40px] bg-white border-2 border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition font-semibold shadow-sm text-xs sm:text-base whitespace-nowrap flex items-center justify-center"
            >
              <span className="sm:hidden">Create</span>
              <span className="hidden sm:inline">Create Agent</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex-1 max-w-7xl mx-auto p-4 sm:p-8 overflow-hidden">
        <div className="flex gap-4 h-full">
          {/* Chat Area */}
          <div className="flex-1 bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-purple-100 overflow-hidden">
            <div className="flex flex-col h-full">

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6 bg-gradient-to-br from-gray-50 to-purple-50/30">
              {history.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center p-4 sm:p-8 bg-white/80 backdrop-blur-sm rounded-xl shadow-md border border-purple-100 max-w-md">
                    <div className="text-3xl sm:text-5xl mb-2 sm:mb-4">💬</div>
                    <h2 className="text-base sm:text-xl font-bold text-gray-800 mb-1 sm:mb-2">Start a Conversation</h2>
                    <p className="text-gray-600 text-xs sm:text-sm mb-3 sm:mb-4">
                      Chat with {agentName}
                    </p>
                    <div className="bg-purple-50 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg">
                      <span className="text-xs text-gray-500">Session: </span>
                      <span className="text-xs font-mono text-purple-700">{contextId.substring(0, 8)}...</span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {history.map((msg) => (
                    <div key={msg.messageId} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`p-2.5 sm:p-4 rounded-xl shadow-md max-w-[85%] sm:max-w-3xl leading-relaxed text-xs sm:text-base ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-br-none'
                          : 'bg-white text-gray-800 border border-purple-100 rounded-bl-none'
                      }`}>
                        {renderMessageContent(msg)}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white p-3 sm:p-4 rounded-xl shadow-md border border-purple-100">
                        <div className="flex items-center gap-2 text-gray-500">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-500 border-t-transparent"></div>
                          <span className="text-xs sm:text-sm">Waiting for response...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              {error && (
                <div className="flex justify-center">
                  <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl shadow-md max-w-md">
                    <span className="font-semibold">Error: </span>{error}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="p-3 sm:p-4 md:p-5 lg:p-6 border-t border-purple-100 bg-white/80 backdrop-blur-sm">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 min-w-0 px-3 md:px-3.5 lg:px-4 py-2 md:py-2.5 lg:py-3 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-purple-400 focus:ring-2 sm:ring-4 focus:ring-purple-100 transition-all duration-200"
                  placeholder="Type your message..."
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowMemoryModal(true)}
                  className="lg:hidden px-2.5 md:px-3 py-2 md:py-2.5 bg-gradient-to-r from-purple-100 to-blue-100 text-purple-700 font-bold rounded-xl hover:from-purple-200 hover:to-blue-200 transition shadow-md flex items-center justify-center flex-shrink-0"
                  title="Agent Memory"
                >
                  <Archive className="w-5 h-5" />
                </button>
                <button
                  type="submit"
                  className="px-3 md:px-4 lg:px-6 py-2 md:py-2.5 lg:py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl shadow-lg transition-[box-shadow,transform] duration-200 active:scale-95 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none text-xs sm:text-base flex-shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 md:hover:from-purple-700 md:hover:to-blue-700 md:hover:shadow-xl md:hover:-translate-y-0.5"
                  disabled={isLoading || !input.trim()}
                >
                  {isLoading ? (
                    <span className="flex items-center">...</span>
                  ) : (
                    <>
                      <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="hidden sm:inline">Send</span>
                    </>
                  )}
                </button>
              </div>
            </form>
            </div>
          </div>

          {/* Sidebar - Thinking & Caring (Desktop Only) */}
          <div className="hidden lg:block w-96 bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-purple-100 p-6 overflow-y-auto">
            <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-xl sm:text-2xl">🧠</span>
              Agent Memory
            </h3>

            {/* Username */}
            {username && (
              <div className="mb-3 sm:mb-4 p-2.5 sm:p-3 bg-gradient-to-r from-green-50 to-teal-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs sm:text-sm font-semibold text-green-700">User:</span>
                </div>
                <div className="text-xs sm:text-sm font-mono text-green-900 bg-white/50 px-2 py-1 rounded">
                  {username}
                </div>
              </div>
            )}

            {/* Current Intent */}
            {currentIntent && (
              <div className="mb-3 sm:mb-4 p-2.5 sm:p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs sm:text-sm font-semibold text-purple-700">Current Topic:</span>
                  <span className="text-xs font-semibold text-purple-600 bg-white/70 px-2 py-0.5 rounded-full">
                    {thinkingFacts.length} facts
                  </span>
                </div>
                <div className="text-xs sm:text-sm font-mono text-purple-900 bg-white/50 px-2 py-1 rounded">
                  {currentIntent}
                </div>
              </div>
            )}

            {/* Thinking Facts */}
            <div className="mb-4 sm:mb-6">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-blue-500 rounded-full animate-pulse"></div>
                  <h4 className="font-semibold text-xs sm:text-sm text-blue-700">Thinking Memory</h4>
                </div>
              </div>

              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-3 sm:p-4 rounded-lg border border-blue-200">
                {thinkingFacts.length > 0 ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    {thinkingFacts.map((fact, index) => (
                      <div
                        key={index}
                        className="flex gap-2 text-xs bg-white/80 p-2 sm:p-2.5 rounded-md border border-blue-100 hover:border-blue-300 transition-colors group"
                      >
                        <span className="text-blue-600 font-bold flex-shrink-0 group-hover:scale-110 transition-transform text-xs">
                          {index + 1}.
                        </span>
                        <span className="text-gray-700 leading-relaxed text-xs">
                          {fact}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 sm:py-6">
                    <div className="text-2xl sm:text-3xl mb-2 opacity-50">💭</div>
                    <p className="text-xs text-gray-400 italic">
                      {currentIntent
                        ? 'Learning about this topic...'
                        : 'Start a conversation to build knowledge'
                      }
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Caring */}
            <div>
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-pink-500 rounded-full animate-pulse"></div>
                  <h4 className="font-semibold text-xs sm:text-sm text-pink-700">Caring Memory</h4>
                </div>
                {caringFacts.length > 0 && (
                  <span className="text-xs font-semibold text-pink-600 bg-white/70 px-2 py-0.5 rounded-full">
                    {caringFacts.length} facts
                  </span>
                )}
              </div>
              <div className="bg-gradient-to-br from-pink-50 to-rose-50 p-3 sm:p-4 rounded-lg border border-pink-200">
                {caringFacts.length > 0 ? (
                  <div className="space-y-1.5 sm:space-y-2">
                    {caringFacts.map((fact, index) => (
                      <div
                        key={index}
                        className="flex gap-2 text-xs bg-white/80 p-2 sm:p-2.5 rounded-md border border-pink-100 hover:border-pink-300 transition-colors group"
                      >
                        <span className="text-pink-600 font-bold flex-shrink-0 group-hover:scale-110 transition-transform text-xs">
                          {index + 1}.
                        </span>
                        <span className="text-gray-700 leading-relaxed text-xs">
                          {fact}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 sm:py-6">
                    <div className="text-2xl sm:text-3xl mb-2 opacity-50">💝</div>
                    <p className="text-xs text-gray-400 italic">
                      {username
                        ? 'Learning about how you think...'
                        : 'Set username to build caring memory'
                      }
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center leading-relaxed">
                <span className="font-semibold">Thinking:</span> Logic for agent&apos;s thought 🧠<br/>
                <span className="font-semibold">Caring:</span> Logic for user&apos;s thought 💝
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Memory Modal */}
      {showMemoryModal && (
        <div className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-purple-100 bg-gradient-to-r from-purple-50 to-blue-50">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <span className="text-xl">🧠</span>
                Agent Memory
              </h3>
              <button
                onClick={() => setShowMemoryModal(false)}
                className="w-7 h-7 flex items-center justify-center bg-white hover:bg-gray-100 rounded-full transition-colors"
              >
                <span className="text-gray-600 text-sm">✕</span>
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="overflow-y-auto p-3" style={{ maxHeight: 'calc(80vh - 60px)' }}>
              {/* Username */}
              {username && (
                <div className="mb-3 p-2 bg-gradient-to-r from-green-50 to-teal-50 rounded-lg border border-green-200">
                  <span className="text-xs font-semibold text-green-700 block mb-1">User:</span>
                  <div className="text-xs font-mono text-green-900 bg-white/50 px-2 py-1 rounded">
                    {username}
                  </div>
                </div>
              )}

              {/* Current Intent */}
              {currentIntent && (
                <div className="mb-3 p-2 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-purple-700">Current Topic:</span>
                    <span className="text-xs font-semibold text-purple-600 bg-white/70 px-1.5 py-0.5 rounded-full">
                      {thinkingFacts.length}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-purple-900 bg-white/50 px-2 py-1 rounded">
                    {currentIntent}
                  </div>
                </div>
              )}

              {/* Thinking Facts */}
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <h4 className="font-semibold text-xs text-blue-700">Thinking Memory</h4>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-2.5 rounded-lg border border-blue-200">
                  {thinkingFacts.length > 0 ? (
                    <div className="space-y-1.5">
                      {thinkingFacts.map((fact, index) => (
                        <div key={index} className="flex gap-1.5 text-xs bg-white/80 p-2 rounded-md border border-blue-100">
                          <span className="text-blue-600 font-bold flex-shrink-0">{index + 1}.</span>
                          <span className="text-gray-700 leading-relaxed">{fact}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <div className="text-2xl mb-1 opacity-50">💭</div>
                      <p className="text-xs text-gray-400 italic">
                        {currentIntent ? 'Learning...' : 'Start chatting'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Caring Memory */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 bg-pink-500 rounded-full animate-pulse"></div>
                  <h4 className="font-semibold text-xs text-pink-700">Caring Memory</h4>
                </div>
                <div className="bg-gradient-to-br from-pink-50 to-rose-50 p-2.5 rounded-lg border border-pink-200">
                  {caringFacts.length > 0 ? (
                    <div className="space-y-1.5">
                      {caringFacts.map((fact, index) => (
                        <div key={index} className="flex gap-1.5 text-xs bg-white/80 p-2 rounded-md border border-pink-100">
                          <span className="text-pink-600 font-bold flex-shrink-0">{index + 1}.</span>
                          <span className="text-gray-700 leading-relaxed">{fact}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <div className="text-2xl mb-1 opacity-50">💝</div>
                      <p className="text-xs text-gray-400 italic">
                        {username ? 'Learning about you...' : 'Set username'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="mt-4 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500 text-center leading-relaxed">
                  <span className="font-semibold">Thinking:</span> Agent 🧠 | <span className="font-semibold">Caring:</span> User 💝
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}