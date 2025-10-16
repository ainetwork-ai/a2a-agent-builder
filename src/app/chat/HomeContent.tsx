'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { A2AClient } from "@a2a-js/sdk/client";
import { SendMessageSuccessResponse } from "@a2a-js/sdk";
import { Message, MessageSendParams, TextPart } from "@a2a-js/sdk";
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

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
  const [allIntents, setAllIntents] = useState<Array<{intent: string, factCount: number}>>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
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
        const cardResponse = await fetch(cardUrl);
        if (!cardResponse.ok) {
          throw new Error(`Agent card not found (${cardResponse.status}). Did you deploy the agent?`);
        }
        const card = await cardResponse.json();
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

      const response = await fetch(statusUrl);
      if (response.ok) {
        const data = await response.json();
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

        // Update all intents list
        if (data.allIntents) {
          setAllIntents(data.allIntents);
        }
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
      const response = await fetch(updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextId,
          conversationHistory,
          intent, // Pass pre-classified intent to avoid re-classification
          username // Pass username for caring memory
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Memory updated:', data);

        // Fetch updated status to get new thinking facts
        await fetchStatus();
      }
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
          const intent = (resultEvent as any).metadata?.intent;
          console.log('📨 Agent response:', {
            hasMetadata: !!(resultEvent as any).metadata,
            intent,
            fullMetadata: (resultEvent as any).metadata
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
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
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
                className="w-full px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl hover:from-purple-700 hover:to-blue-700 transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:bg-gray-300 disabled:cursor-not-allowed"
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
      <nav className="bg-white/80 backdrop-blur-md border-b border-purple-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-white text-xl font-bold">🏠</span>
            </div>
            <span className="font-bold text-gray-700 group-hover:text-purple-600 transition-colors">Home</span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg">
              <span className="text-sm font-semibold text-purple-700">{agentName}</span>
            </div>
            <Link
              href="/builder"
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition font-semibold shadow-md"
            >
              ✨ Agent Builder
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-8">
        <div className="flex gap-4" style={{ height: 'calc(100vh - 200px)' }}>
          {/* Chat Area */}
          <div className="flex-1 bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-purple-100 overflow-hidden">
            <div className="flex flex-col h-full">

            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-br from-gray-50 to-purple-50/30">
              {history.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center p-8 bg-white/80 backdrop-blur-sm rounded-xl shadow-md border border-purple-100 max-w-md">
                    <div className="text-5xl mb-4">💬</div>
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Start a Conversation</h2>
                    <p className="text-gray-600 text-sm mb-4">
                      Chat with {agentName} using A2A Protocol
                    </p>
                    <div className="bg-purple-50 px-4 py-2 rounded-lg">
                      <span className="text-xs text-gray-500">Session: </span>
                      <span className="text-xs font-mono text-purple-700">{contextId.substring(0, 8)}...</span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {history.map((msg) => (
                    <div key={msg.messageId} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`p-4 rounded-xl shadow-md max-w-3xl leading-relaxed ${
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
                      <div className="bg-white p-4 rounded-xl shadow-md border border-purple-100">
                        <div className="flex items-center gap-2 text-gray-500">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-500 border-t-transparent"></div>
                          <span className="text-sm">Waiting for response via A2A Protocol...</span>
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

            <form onSubmit={handleSubmit} className="p-6 border-t border-purple-100 bg-white/80 backdrop-blur-sm">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 p-4 text-lg border-2 border-gray-200 rounded-xl focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 transition-all duration-200"
                  placeholder="Type your message..."
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  className="px-8 py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl hover:from-purple-700 hover:to-blue-700 transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                  disabled={isLoading || !input.trim()}
                >
                  {isLoading ? '...' : 'Send'}
                </button>
              </div>
            </form>
            </div>
          </div>

          {/* Sidebar - Thinking & Caring */}
          <div className="w-96 bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-purple-100 p-6 overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">🧠</span>
              Agent Memory
            </h3>

            {/* Username */}
            {username && (
              <div className="mb-4 p-3 bg-gradient-to-r from-green-50 to-teal-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-green-700">User:</span>
                </div>
                <div className="text-sm font-mono text-green-900 bg-white/50 px-2 py-1 rounded">
                  {username}
                </div>
              </div>
            )}

            {/* Current Intent */}
            {currentIntent && (
              <div className="mb-4 p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-purple-700">Current Topic:</span>
                  <span className="text-xs font-semibold text-purple-600 bg-white/70 px-2 py-0.5 rounded-full">
                    {thinkingFacts.length} facts
                  </span>
                </div>
                <div className="text-sm font-mono text-purple-900 bg-white/50 px-2 py-1 rounded">
                  {currentIntent}
                </div>
              </div>
            )}

            {/* Thinking Facts */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                  <h4 className="font-semibold text-sm text-blue-700">Thinking Memory</h4>
                </div>
              </div>

              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                {thinkingFacts.length > 0 ? (
                  <div className="space-y-2">
                    {thinkingFacts.map((fact, index) => (
                      <div
                        key={index}
                        className="flex gap-2 text-xs bg-white/80 p-2.5 rounded-md border border-blue-100 hover:border-blue-300 transition-colors group"
                      >
                        <span className="text-blue-600 font-bold flex-shrink-0 group-hover:scale-110 transition-transform">
                          {index + 1}.
                        </span>
                        <span className="text-gray-700 leading-relaxed">
                          {fact}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="text-3xl mb-2 opacity-50">💭</div>
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
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-pink-500 rounded-full animate-pulse"></div>
                  <h4 className="font-semibold text-sm text-pink-700">Caring Memory</h4>
                </div>
                {caringFacts.length > 0 && (
                  <span className="text-xs font-semibold text-pink-600 bg-white/70 px-2 py-0.5 rounded-full">
                    {caringFacts.length} facts
                  </span>
                )}
              </div>
              <div className="bg-gradient-to-br from-pink-50 to-rose-50 p-4 rounded-lg border border-pink-200">
                {caringFacts.length > 0 ? (
                  <div className="space-y-2">
                    {caringFacts.map((fact, index) => (
                      <div
                        key={index}
                        className="flex gap-2 text-xs bg-white/80 p-2.5 rounded-md border border-pink-100 hover:border-pink-300 transition-colors group"
                      >
                        <span className="text-pink-600 font-bold flex-shrink-0 group-hover:scale-110 transition-transform">
                          {index + 1}.
                        </span>
                        <span className="text-gray-700 leading-relaxed">
                          {fact}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="text-3xl mb-2 opacity-50">💝</div>
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
                <span className="font-semibold">Thinking:</span> Logic for agent's thought 🧠<br/>
                <span className="font-semibold">Caring:</span> Logic for user's thought 💝
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}