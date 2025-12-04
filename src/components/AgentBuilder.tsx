'use client';

import React, { useState } from 'react';
import { AgentBuilderForm, AgentConfig } from '@/types/agent';
import Link from 'next/link';
import { WalletButton } from './WalletButton';
import { useAccount } from 'wagmi';
import { transliterate } from 'transliteration';
import slugify from 'slugify';
import { AgentForm } from './AgentForm';

export default function AgentBuilder() {
  const { address, isConnected } = useAccount();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [prompt, setPrompt] = useState('');
  const [generatedForm, setGeneratedForm] = useState<AgentBuilderForm | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [deployedAgent, setDeployedAgent] = useState<{ url: string; cardUrl: string } | null>(null);
  const [deployingAgentId, setDeployingAgentId] = useState<string | null>(null);

  const generateAgentFromPrompt = async () => {
    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate agent');
      }

      const data = await response.json();
      setGeneratedForm(data);
    } catch (error) {
      console.error('Error generating agent:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to generate agent: ${errorMessage}\n\nPlease check the server console for detailed logs.`);
    } finally {
      setIsGenerating(false);
    }
  };

  const createAgent = async (data?: AgentBuilderForm) => {
    const agentData = data || generatedForm;
    if (!agentData) return;

    setDeployingAgentId('generating');

    // Use window.location.origin for dynamic URL generation
    const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

    // Convert agent name to meaningful English slug
    // Remove non-ASCII characters, convert to lowercase, replace spaces with hyphens
    const rawName = agentData.name ?? '';
    const romanized = transliterate(rawName);

    const agentSlug = slugify(romanized, {
      lower: true,
      strict: true,
      trim: true,
    });

    // Add timestamp suffix to ensure uniqueness
    const agentId = `${agentSlug}-${Date.now()}`;

    const newAgent: AgentConfig = {
      id: agentId,
      name: agentData.name,
      description: agentData.description,
      prompt: agentData.prompt,
      protocolVersion: '0.3.0',
      version: '0.1.0',
      url: `${siteUrl}/api/agents/${agentId}`,
      capabilities: {},
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: agentData.skills,
      intents: agentData.intents,
      modelProvider: agentData.modelProvider,
      modelName: agentData.modelName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setAgents(prev => [...prev, newAgent]);
    
    // Reset form
    setPrompt('');
    setGeneratedForm(null);
  };

  const exportAgent = (agent: AgentConfig) => {
    const exportData = {
      agentCard: {
        name: agent.name,
        description: agent.description,
        protocolVersion: agent.protocolVersion,
        version: agent.version,
        url: agent.url,
        capabilities: agent.capabilities,
        defaultInputModes: agent.defaultInputModes,
        defaultOutputModes: agent.defaultOutputModes,
        skills: agent.skills,
      },
      config: {
        prompt: agent.prompt,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.name.toLowerCase().replace(/\s+/g, '-')}-agent.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deployAgent = async (agent: AgentConfig) => {
    // Check wallet connection
    if (!isConnected || !address) {
      alert('⚠️ Please connect your wallet to deploy an agent.');
      return;
    }

    setDeployingAgentId(agent.id);
    try {
      const response = await fetch('/api/deploy-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentConfig: agent,
          creatorAddress: address,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to deploy agent');
      }

      // Update deployed status
      setAgents(prev => prev.map(a =>
        a.id === agent.id ? { ...a, deployed: true } : a
      ));

      const agentCardUrl = `${agent.url}/.well-known/agent.json`;
      setDeployedAgent({ url: agent.url, cardUrl: agentCardUrl });
    } catch (error) {
      console.error('Error deploying agent:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`❌ Failed to deploy agent: ${errorMessage}\n\nPlease check the server console for detailed logs.`);
    } finally {
      setDeployingAgentId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
      {/* Navigation Bar */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-purple-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2 sm:gap-3 group min-w-0 flex-shrink">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
              <span className="text-white text-lg sm:text-xl font-bold">🏠</span>
            </div>
            <span className="font-bold text-sm sm:text-base text-gray-700 group-hover:text-purple-600 transition-colors truncate">Home</span>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <WalletButton />
            <div className="px-2 py-1.5 sm:px-4 sm:py-2 bg-gradient-to-r from-purple-100 to-blue-100 rounded-lg h-[30px] sm:h-[40px] flex items-center">
              <span className="text-xs sm:text-sm font-semibold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap">
                <span className="hidden sm:inline">A2A Protocol </span>v0.3.0
              </span>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-4 sm:p-8">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-12 mt-4 sm:mt-8">
          <h1 className="text-3xl sm:text-5xl font-extrabold mb-3 sm:mb-4 bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent leading-tight">
            A2A Agent Builder
          </h1>
          <p className="text-gray-600 text-base sm:text-lg">Build and deploy your own AI agents quickly and easily</p>
        </div>

        {/* Create New Agent Section - Centered */}
        <div className="max-w-3xl mx-auto mb-8">
          <div className="space-y-6 bg-white/90 backdrop-blur-sm p-4 sm:p-8 rounded-2xl shadow-xl border border-purple-100 hover:shadow-2xl transition-shadow duration-300">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xl sm:text-2xl font-bold">✨</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Create New Agent</h2>
            </div>
          
          <div>
            <label className="block text-sm font-semibold mb-3 text-gray-700">
              Agent Description
              <span className="text-gray-400 font-normal ml-2">(What kind of agent would you like to create?)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full p-3 sm:p-4 border-2 border-gray-200 rounded-xl h-32 sm:h-40 focus:border-purple-400 focus:ring-4 focus:ring-purple-100 focus:outline-none transition-all duration-200 resize-none text-base text-gray-900 placeholder:text-gray-400"
              placeholder="Example: Create an AI tutor that teaches Web3 using the Socratic method"
            />
          </div>

          <button
            onClick={generateAgentFromPrompt}
            disabled={isGenerating || !prompt.trim()}
            className="w-full py-3 sm:py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl hover:from-purple-700 hover:to-blue-700 font-bold text-base sm:text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          >
            {isGenerating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⚡</span> Generating...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                🤖 Generate Agent with AI
              </span>
            )}
          </button>

          {/* Generated Agent Form */}
          {generatedForm && (
            <div className="mt-6 animate-fade-in">
              <div className="mb-4 px-2">
                <h3 className="font-bold text-base sm:text-lg text-purple-900 flex items-center gap-2">
                  ✨ Generated Agent
                </h3>
                <p className="text-sm text-gray-600 mt-1">Review and customize your agent before creating</p>
              </div>

              {/* Full width form - No preview mode */}
              <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-6 border border-purple-200">
                <AgentForm
                  initialData={generatedForm}
                  onSubmit={(data) => createAgent(data)}
                  onCancel={() => setGeneratedForm(null)}
                  isSubmitting={!!deployingAgentId}
                  submitLabel="Create"
                />
              </div>
            </div>
          )}
          </div>
        </div>

        {/* Created Agents Section - Show all created agents */}
        {agents.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xl sm:text-2xl font-bold">🤖</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Created Agents</h2>
            </div>

            <div className="space-y-4">
              {agents.map(agent => (
                <div key={agent.id} className="bg-white/90 backdrop-blur-sm p-4 sm:p-6 rounded-2xl shadow-xl border border-blue-100 hover:shadow-2xl hover:border-blue-300 transition-all duration-300">
                  <div className="flex items-start justify-between mb-4 gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-2">{agent.name}</h3>
                      <p className="text-sm sm:text-base text-gray-600 leading-relaxed">{agent.description}</p>
                    </div>
                    <div className={`px-2.5 sm:px-3 py-1 rounded-full flex-shrink-0 ${
                      agent.deployed
                        ? 'bg-gradient-to-br from-green-100 to-emerald-100'
                        : 'bg-gradient-to-br from-yellow-100 to-orange-100'
                    }`}>
                      <span className={`text-xs font-bold whitespace-nowrap ${
                        agent.deployed ? 'text-green-700' : 'text-orange-700'
                      }`}>
                        {agent.deployed ? '✅ LIVE' : '⚠️ DRAFT'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5 mt-4 bg-gray-50 p-3 sm:p-4 rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-700 text-xs sm:text-sm whitespace-nowrap">🧠 Model:</span>
                      <span className="text-gray-600 text-xs sm:text-sm truncate">{agent.modelProvider} / {agent.modelName}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-semibold text-gray-700 text-xs sm:text-sm whitespace-nowrap">⚡ Skills:</span>
                      <div className="flex flex-wrap gap-1">
                        {agent.skills.map(s => (
                          <span key={s.id} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2 pt-1">
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-gray-700 text-xs sm:text-sm whitespace-nowrap">🔗 URL:</span>
                        <code className="flex-1 bg-white px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs border border-gray-200 break-all">{agent.url}</code>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 sm:mt-5 flex flex-wrap gap-2">
                    <button
                      onClick={() => deployAgent(agent)}
                      disabled={agent.deployed || deployingAgentId === agent.id}
                      className={`flex-1 min-w-[100px] px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg font-semibold shadow-md transition-all duration-200 text-sm sm:text-base ${
                        agent.deployed || deployingAgentId === agent.id
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600 hover:shadow-lg transform hover:-translate-y-0.5'
                      }`}
                    >
                      {deployingAgentId === agent.id ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Deploying...
                        </span>
                      ) : agent.deployed ? '✅ Deployed' : '🚀 Deploy'}
                    </button>
                    <button
                      onClick={() => exportAgent(agent)}
                      className="flex-1 min-w-[100px] px-3 sm:px-4 py-2 sm:py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 font-semibold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200 text-sm sm:text-base"
                    >
                      💾 Export
                    </button>
                    {agent.deployed ? (
                      <a
                        href={`/chat?agentUrl=${encodeURIComponent(agent.url)}`}
                        className="flex-1 min-w-[100px] px-3 sm:px-4 py-2 sm:py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 font-semibold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200 text-center text-sm sm:text-base"
                      >
                        💬 Chat
                      </a>
                    ) : (
                      <button
                        disabled
                        className="flex-1 min-w-[100px] px-3 sm:px-4 py-2 sm:py-2.5 bg-gray-300 text-gray-500 rounded-lg font-semibold cursor-not-allowed text-sm sm:text-base"
                        title="Deploy the agent first to test chat"
                      >
                        💬 Chat
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Deploy Success Modal */}
      {deployedAgent && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setDeployedAgent(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8 animate-fade-in relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close X Button */}
            <button
              onClick={() => setDeployedAgent(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors p-1"
              aria-label="Close modal"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-green-100 to-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">✅</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Agent Deployed!</h3>
              <p className="text-sm sm:text-base text-gray-600">Your agent is now live and ready to use</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Base URL</label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(deployedAgent.url);
                    alert('Base URL copied to clipboard!');
                  }}
                  className="w-full bg-gray-50 hover:bg-gray-100 border-2 border-gray-200 hover:border-purple-300 rounded-lg p-3 text-left transition-all group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs sm:text-sm text-gray-700 break-all flex-1">{deployedAgent.url}</code>
                    <span className="text-gray-400 group-hover:text-purple-600 text-sm flex-shrink-0">📋 Copy</span>
                  </div>
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Agent Card URL</label>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(deployedAgent.cardUrl);
                    alert('Agent Card URL copied to clipboard!');
                  }}
                  className="w-full bg-gray-50 hover:bg-gray-100 border-2 border-gray-200 hover:border-purple-300 rounded-lg p-3 text-left transition-all group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs sm:text-sm text-gray-700 break-all flex-1">{deployedAgent.cardUrl}</code>
                    <span className="text-gray-400 group-hover:text-purple-600 text-sm flex-shrink-0">📋 Copy</span>
                  </div>
                </button>
              </div>
            </div>

            <button
              onClick={() => setDeployedAgent(null)}
              className="w-full mt-6 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 font-semibold shadow-md hover:shadow-lg transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}