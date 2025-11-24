'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import EditAgentModal from './EditAgentModal';
import { WalletButton } from './WalletButton';
import { useAccount } from 'wagmi';

interface DeployedAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  modelProvider: string;
  modelName: string;
  prompt: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
  deployed: boolean;
  creator?: string;
}

export default function DeployedAgents() {
  const { address, isConnected } = useAccount();
  const [agents, setAgents] = useState<DeployedAgent[]>([]);
  const [editingAgent, setEditingAgent] = useState<DeployedAgent | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await fetch('/api/agents/list');
        const data = await response.json();
        setAgents(data.agents || []);
      } catch (error) {
        console.error('Failed to fetch agents:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgents();
  }, []);

  const deleteAgent = async (agentId: string) => {
    if (!isConnected || !address) {
      alert('⚠️ Please connect your wallet to delete an agent.');
      return;
    }

    if (!confirm('Are you sure you want to delete this agent? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.toLowerCase() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete agent');
      }

      // Remove agent from list
      setAgents(prev => prev.filter(agent => agent.id !== agentId));
      alert('✅ Agent deleted successfully!');
    } catch (error) {
      console.error('Error deleting agent:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`❌ ${errorMessage}`);
    }
  };

  // Check if current user owns the agent
  const isOwner = (agent: DeployedAgent): boolean => {
    if (!isConnected || !address || !agent.creator) {
      return false; // If no wallet connected, no creator, or legacy agent
    }
    return agent.creator.toLowerCase() === address.toLowerCase();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100">
      {/* Navigation Bar */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-purple-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
              <span className="text-white text-xl font-bold">🤖</span>
            </div>
            <span className="font-bold text-xl bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              A2A Agent Hub
            </span>
          </div>
          <div className="flex items-center gap-3">
            <WalletButton />
            <Link
              href="/builder"
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition font-semibold shadow-md"
            >
              ✨ Create Agent
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="text-center mb-12 mt-8">
          <h1 className="text-5xl font-extrabold mb-4 bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Deployed A2A Agents
          </h1>
          <p className="text-gray-600 text-lg">Chat with deployed AI agents</p>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">Loading agents...</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="bg-white/90 backdrop-blur-sm p-12 rounded-2xl shadow-xl border border-blue-100 text-center">
            <div className="text-6xl mb-4">🤷</div>
            <p className="text-gray-500 text-lg mb-4">No deployed agents yet</p>
            <Link
              href="/builder"
              className="inline-block px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition font-semibold shadow-md"
            >
              Create Your First Agent
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map(agent => (
              <div
                key={agent.id}
                className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-blue-100 hover:shadow-2xl hover:border-blue-300 transition-all duration-300 hover:-translate-y-1"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-2xl">🤖</span>
                  </div>
                  <div className="bg-gradient-to-br from-green-100 to-emerald-100 px-3 py-1 rounded-full">
                    <span className="text-xs font-bold text-green-700">✅ LIVE</span>
                  </div>
                </div>

                {/* Content */}
                <h3 className="text-xl font-bold text-gray-800 mb-2">{agent.name}</h3>
                <p className="text-gray-600 text-sm mb-4 line-clamp-3">{agent.description}</p>

                {/* Skills */}
                <div className="mb-4">
                  <div className="flex flex-wrap gap-1.5">
                    {agent.skills.slice(0, 3).map(skill => (
                      <span
                        key={skill.id}
                        className="px-2 py-1 bg-purple-100 text-purple-700 rounded-md text-xs font-semibold"
                      >
                        {skill.name}
                      </span>
                    ))}
                    {agent.skills.length > 3 && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-md text-xs font-semibold">
                        +{agent.skills.length - 3} more
                      </span>
                    )}
                  </div>
                </div>

                {/* Model Info */}
                <div className="bg-gray-50 p-3 rounded-lg mb-4">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="font-semibold">🧠 Model:</span>
                    <span>{agent.modelProvider} / {agent.modelName}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <Link
                    href={`/chat?agentUrl=${encodeURIComponent(agent.url)}`}
                    className="block w-full py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 font-semibold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200 text-center"
                  >
                    💬 Start Chat
                  </Link>
                  <button
                    onClick={() => {
                      const agentCardUrl = `${agent.url}/.well-known/agent.json`;
                      navigator.clipboard.writeText(agentCardUrl);
                      alert('Agent Card URL copied to clipboard!');
                    }}
                    className="w-full py-2 bg-white border-2 border-gray-200 text-gray-700 rounded-lg hover:border-purple-300 hover:bg-purple-50 font-semibold transition-all duration-200 text-sm"
                  >
                    📋 Copy Agent URL
                  </button>
                  {/* Only show Edit/Delete buttons to agent owners */}
                  {isOwner(agent) && (
                    <>
                      <button
                        onClick={() => setEditingAgent(agent)}
                        className="w-full py-2 bg-white border-2 border-blue-200 text-blue-600 rounded-lg hover:border-blue-400 hover:bg-blue-50 font-semibold transition-all duration-200 text-sm"
                      >
                        ✏️ Edit Agent
                      </button>
                      <button
                        onClick={() => deleteAgent(agent.id)}
                        className="w-full py-2 bg-white border-2 border-red-200 text-red-600 rounded-lg hover:border-red-400 hover:bg-red-50 font-semibold transition-all duration-200 text-sm"
                      >
                        🗑️ Delete Agent
                      </button>
                    </>
                  )}
                  {/* Show message for non-owners */}
                  {!isOwner(agent) && agent.creator && (
                    <div className="w-full py-2 text-center text-xs text-gray-500 italic">
                      Connect wallet to edit/delete
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer Info */}
        <div className="mt-12 text-center">
          <div className="inline-block bg-white/80 backdrop-blur-sm px-6 py-4 rounded-xl shadow-md border border-purple-100">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-purple-600">A2A Protocol v0.3.0</span>
              {' '} • Agent-to-Agent Communication Standard
            </p>
          </div>
        </div>
      </div>

      {/* Edit Agent Modal */}
      {editingAgent && (
        <EditAgentModal
          isOpen={!!editingAgent}
          onClose={() => setEditingAgent(null)}
          agent={editingAgent}
          onSuccess={() => {
            // Refresh agents list
            const fetchAgents = async () => {
              try {
                const response = await fetch('/api/agents/list');
                const data = await response.json();
                setAgents(data.agents || []);
              } catch (error) {
                console.error('Failed to fetch agents:', error);
              }
            };
            fetchAgents();
          }}
        />
      )}
    </div>
  );
}
