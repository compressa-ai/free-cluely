import React, { useState, useEffect } from 'react';

type Provider = "ollama" | "gemini" | "openai"

interface ModelConfig {
  provider: Provider;
  model: string;
  isOllama: boolean;
}

interface ModelSelectorProps {
  onModelChange?: (provider: Provider, model: string) => void;
  onChatOpen?: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelChange, onChatOpen }) => {
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
  const [availableOllamaModels, setAvailableOllamaModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'testing' | 'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o');
  const [selectedProvider, setSelectedProvider] = useState<Provider>("gemini");
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>("");
  const [ollamaUrl, setOllamaUrl] = useState<string>("http://localhost:11434");
  const [systemPromptDraft, setSystemPromptDraft] = useState('');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('');
  const [promptSaveStatus, setPromptSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [promptSaveError, setPromptSaveError] = useState('');

  useEffect(() => {
    loadCurrentConfig();
  }, []);

  const loadCurrentConfig = async () => {
    try {
      setIsLoading(true);
      const [config, promptData] = await Promise.all([
        window.electronAPI.getCurrentLlmConfig(),
        window.electronAPI.getSystemPrompt(),
      ]);
      setCurrentConfig(config);
      setSelectedProvider(config.provider);
      setSystemPromptDraft(promptData.prompt);
      setDefaultSystemPrompt(promptData.defaultPrompt);

      if (config.isOllama) {
        setSelectedOllamaModel(config.model);
        await loadOllamaModels();
      } else if (config.provider === "openai") {
        setOpenaiModel(config.model);
      }
    } catch (error) {
      console.error('Error loading current config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadOllamaModels = async () => {
    try {
      const models = await window.electronAPI.getAvailableOllamaModels();
      setAvailableOllamaModels(models);
      
      // Auto-select first model if none selected
      if (models.length > 0 && !selectedOllamaModel) {
        setSelectedOllamaModel(models[0]);
      }
    } catch (error) {
      console.error('Error loading Ollama models:', error);
      setAvailableOllamaModels([]);
    }
  };

  const handleSaveSystemPrompt = async () => {
    try {
      setPromptSaveStatus('saving');
      setPromptSaveError('');
      const result = await window.electronAPI.setSystemPrompt(systemPromptDraft);
      if (result.success) {
        setPromptSaveStatus('saved');
        setTimeout(() => setPromptSaveStatus('idle'), 2000);
      } else {
        setPromptSaveStatus('error');
        setPromptSaveError(result.error || 'Save failed');
      }
    } catch (e) {
      setPromptSaveStatus('error');
      setPromptSaveError(String(e));
    }
  };

  const handleResetSystemPrompt = () => {
    setSystemPromptDraft(defaultSystemPrompt);
  };

  const handleClearStoredPrompt = async () => {
    try {
      setPromptSaveStatus('saving');
      const result = await window.electronAPI.setSystemPrompt('');
      if (result.success) {
        setSystemPromptDraft(defaultSystemPrompt);
        setPromptSaveStatus('saved');
        setTimeout(() => setPromptSaveStatus('idle'), 2000);
      } else {
        setPromptSaveStatus('error');
        setPromptSaveError(result.error || 'Reset failed');
      }
    } catch (e) {
      setPromptSaveStatus('error');
      setPromptSaveError(String(e));
    }
  };

  const testConnection = async () => {
    try {
      setConnectionStatus('testing');
      const result = await window.electronAPI.testLlmConnection();
      setConnectionStatus(result.success ? 'success' : 'error');
      if (!result.success) {
        setErrorMessage(result.error || 'Unknown error');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage(String(error));
    }
  };

  const handleProviderSwitch = async () => {
    try {
      setConnectionStatus('testing');
      let result;
      if (selectedProvider === 'ollama') {
        result = await window.electronAPI.switchToOllama(selectedOllamaModel, ollamaUrl);
      } else if (selectedProvider === 'openai') {
        result = await window.electronAPI.switchToOpenAI(openaiApiKey || undefined, openaiModel || undefined);
      } else {
        result = await window.electronAPI.switchToGemini(geminiApiKey || undefined);
      }
      if (result.success) {
        await loadCurrentConfig();
        setConnectionStatus('success');
        const modelName = selectedProvider === 'ollama' ? selectedOllamaModel : selectedProvider === 'openai' ? openaiModel : 'gemini-2.0-flash';
        onModelChange?.(selectedProvider, modelName);
        setTimeout(() => onChatOpen?.(), 500);
      } else {
        setConnectionStatus('error');
        setErrorMessage(result.error || 'Switch failed');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage(String(error));
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'testing': return 'text-yellow-600';
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'testing': return 'Testing connection...';
      case 'success': return 'Connected successfully';
      case 'error': return `Error: ${errorMessage}`;
      default: return 'Ready';
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-white/20 backdrop-blur-md rounded-lg border border-white/30">
        <div className="animate-pulse text-sm text-gray-600">Loading model configuration...</div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white/20 backdrop-blur-md rounded-lg border border-white/30 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">AI Model Selection</h3>
        <div className={`text-xs ${getStatusColor()}`}>
          {getStatusText()}
        </div>
      </div>

      {/* Current Status */}
      {currentConfig && (
        <div className="text-xs text-gray-600 bg-white/40 p-2 rounded">
          Current: {currentConfig.provider === 'ollama' ? '🏠' : '☁️'} {currentConfig.model}
        </div>
      )}

      {/* Provider Selection */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-700">Provider</label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedProvider('gemini')}
            className={`flex-1 min-w-0 px-2 py-2 rounded text-xs transition-all ${
              selectedProvider === 'gemini' ? 'bg-blue-500 text-white shadow-md' : 'bg-white/40 text-gray-700 hover:bg-white/60'
            }`}
          >
            ☁️ Gemini
          </button>
          <button
            onClick={() => setSelectedProvider('openai')}
            className={`flex-1 min-w-0 px-2 py-2 rounded text-xs transition-all ${
              selectedProvider === 'openai' ? 'bg-emerald-600 text-white shadow-md' : 'bg-white/40 text-gray-700 hover:bg-white/60'
            }`}
          >
            ☁️ OpenAI
          </button>
          <button
            onClick={() => setSelectedProvider('ollama')}
            className={`flex-1 min-w-0 px-2 py-2 rounded text-xs transition-all ${
              selectedProvider === 'ollama' ? 'bg-green-500 text-white shadow-md' : 'bg-white/40 text-gray-700 hover:bg-white/60'
            }`}
          >
            🏠 Ollama
          </button>
        </div>
      </div>

      {/* Provider-specific settings */}
      {selectedProvider === 'gemini' ? (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-700">Gemini API Key (optional if already set)</label>
          <input
            type="password"
            placeholder="Enter API key to update..."
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-white/40 border border-white/60 rounded focus:outline-none focus:ring-2 focus:ring-blue-400/60"
          />
        </div>
      ) : selectedProvider === 'openai' ? (
        <div className="space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
          <div>
            <label className="text-xs font-semibold text-gray-800">OpenAI API key</label>
            <p className="text-[11px] text-gray-600 mt-0.5 mb-1.5">
              Paste your secret key from{' '}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 underline hover:text-emerald-900"
              >
                platform.openai.com/api-keys
              </a>
              . Leave empty if <code className="text-[10px] bg-white/50 px-1 rounded">OPENAI_API_KEY</code> is already set (e.g. in <code className="text-[10px] bg-white/50 px-1 rounded">.env</code>)—use this field to update the key in the running app.
            </p>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-... (required on first OpenAI setup)"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white/50 border border-emerald-200/80 rounded focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Model</label>
            <select
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white/50 border border-emerald-200/80 rounded focus:outline-none focus:ring-2 focus:ring-emerald-400/60 mt-1"
            >
              <optgroup label="GPT-4.1">
                <option value="gpt-4.1">gpt-4.1</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="gpt-4.1-nano">gpt-4.1-nano</option>
              </optgroup>
              <optgroup label="GPT-4o">
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </optgroup>
              <optgroup label="Other">
                <option value="gpt-4-turbo">gpt-4-turbo</option>
              </optgroup>
            </select>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-gray-700">Ollama URL</label>
            <input
              type="url"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white/40 border border-white/60 rounded focus:outline-none focus:ring-2 focus:ring-green-400/60"
            />
          </div>
          
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-700">Model</label>
              <button
                onClick={loadOllamaModels}
                className="px-2 py-1 text-xs bg-white/60 hover:bg-white/80 rounded transition-all"
                title="Refresh models"
              >
                🔄
              </button>
            </div>
            
            {availableOllamaModels.length > 0 ? (
              <select
                value={selectedOllamaModel}
                onChange={(e) => setSelectedOllamaModel(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white/40 border border-white/60 rounded focus:outline-none focus:ring-2 focus:ring-green-400/60"
              >
                {availableOllamaModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-gray-600 bg-yellow-100/60 p-2 rounded">
                No Ollama models found. Make sure Ollama is running and models are installed.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleProviderSwitch}
          disabled={connectionStatus === 'testing'}
          className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white text-xs rounded transition-all shadow-md"
        >
          {connectionStatus === 'testing' ? 'Switching...' : 'Apply Changes'}
        </button>
        
        <button
          onClick={testConnection}
          disabled={connectionStatus === 'testing'}
          className="px-3 py-2 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white text-xs rounded transition-all shadow-md"
        >
          Test
        </button>
      </div>

      <div className="border-t border-white/30 pt-4 space-y-2">
        <h4 className="text-xs font-semibold text-gray-800">System prompt</h4>
        <p className="text-xs text-gray-600">
          Replaces the built-in assistant instructions for chat, screenshots, audio, and solutions.
        </p>
        <textarea
          value={systemPromptDraft}
          onChange={(e) => setSystemPromptDraft(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 text-xs bg-white/50 border border-white/60 rounded focus:outline-none focus:ring-2 focus:ring-violet-400/60 resize-y min-h-[5rem] font-mono"
          spellCheck={false}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={handleSaveSystemPrompt}
            disabled={promptSaveStatus === 'saving'}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-400 text-white text-xs rounded shadow-md"
          >
            {promptSaveStatus === 'saving' ? 'Saving…' : 'Save prompt'}
          </button>
          <button
            type="button"
            onClick={handleResetSystemPrompt}
            className="px-3 py-1.5 bg-white/50 hover:bg-white/70 text-gray-800 text-xs rounded border border-white/60"
          >
            Fill default text
          </button>
          <button
            type="button"
            onClick={handleClearStoredPrompt}
            disabled={promptSaveStatus === 'saving'}
            className="px-3 py-1.5 bg-white/50 hover:bg-white/70 text-gray-800 text-xs rounded border border-white/60"
          >
            Reset to default &amp; clear saved
          </button>
          {promptSaveStatus === 'saved' && (
            <span className="text-xs text-green-600">Saved</span>
          )}
          {promptSaveStatus === 'error' && (
            <span className="text-xs text-red-600">{promptSaveError}</span>
          )}
        </div>
      </div>

      {/* Help text */}
      <div className="text-xs text-gray-600 space-y-1">
        <div>💡 <strong>Gemini:</strong> Google cloud, requires API key</div>
        <div>💡 <strong>OpenAI:</strong> GPT-4o / Whisper, requires API key</div>
        <div>💡 <strong>Ollama:</strong> Private, local, requires Ollama</div>
      </div>
    </div>
  );
};

export default ModelSelector;