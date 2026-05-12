import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { invoke } from "@tauri-apps/api/core";
import { FormsModule } from '@angular/forms';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CommandHistory } from './models/command-history.model';
import { ChatHistory } from './models/chat-history.model';
import {
  AutoInputRule,
  ConnectionAuthMethod,
  ConnectionProfile,
  ConnectionProfileType,
  CreateConnectionProfileInput,
  UpdateConnectionProfilePatch
} from './models/connection-profile.model';
import { TerminalSession } from './models/terminal-session.model';
import { TerminalTabComponent } from './components/terminal-tab/terminal-tab.component';
import { IconComponent } from './components/icon/icon.component';
import { AiCommandService } from './services/ai-command.service';
import { AiResponseFormatService } from './services/ai-response-format.service';
import { ConnectionProfileService } from './services/connection-profile.service';
import { OpenAiCompatibleConnectionService } from './services/open-ai-compatible-connection.service';
import { TerminalSessionService } from './services/terminal-session.service';
import { buildTerminalAssistantSystemPrompt } from './constants/ai.constants';

interface StoredAiSettings {
  apiBaseUrl?: string;
  apiKey?: string;
  currentModel?: string;
  availableModels?: string[];
}

interface ConnectionProfileForm {
  name: string;
  type: ConnectionProfileType;
  jumpHost: string;
  jumpPort: string;
  jumpUser: string;
  jumpPassword: string;
  targetHost: string;
  targetPort: string;
  targetUser: string;
  targetPassword: string;
  authMethod: ConnectionAuthMethod;
  privateKeyPath: string;
  autoInputRules: AutoInputRule[];
  tagsText: string;
  description: string;
}

interface ActiveConnectionRuntime {
  terminalSessionId: string;
  profileId: string;
  profileType: ConnectionProfileType;
  passwordAttempted: boolean;
  firedAutoInputRuleIds: string[];
  createdAt: string;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, TerminalTabComponent, IconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly aiSettingsStorageKey = 'ai-terminal.openai-compatible-settings';

  // Terminal sessions
  terminalSessions: TerminalSession[] = [];
  activeSessionId: string = '';

  // Terminal properties
  commandHistory: CommandHistory[] = [];
  currentWorkingDirectory: string = '~';
  gitBranch: string = '';

  // AI Chat properties
  chatHistory: ChatHistory[] = [];
  currentQuestion: string = '';
  isProcessingAI: boolean = false;
  isAIPanelVisible: boolean = true;
  activeAiView: 'chat' | 'settings' = 'chat';
  aiApiBaseUrl: string = 'https://api.openai.com/v1';
  aiApiKey: string = '';
  currentLLMModel: string = '';
  availableModels: string[] = [];
  aiSettingsStatus: string = '';
  isLoadingModels: boolean = false;

  // Connection profile properties
  connectionProfiles: ConnectionProfile[] = [];
  connectionFormMode: 'create' | 'edit' = 'create';
  editingConnectionProfileId: string = '';
  connectionStatus: string = '';
  isConnectionManagerOpen: boolean = false;
  isConnectionFormOpen: boolean = false;
  connectionForm: ConnectionProfileForm = this.createEmptyConnectionForm();

  // Resizing properties
  leftPanelWidth: number = 600;
  isResizing: boolean = false;
  startX: number = 0;
  startWidth: number = 0;

  // Event listeners
  private unlistenFunctions: UnlistenFn[] = [];

  // Auto-scroll
  @ViewChild('terminalContainer') terminalContainerRef!: ElementRef<HTMLDivElement>;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private ptySessions = new Set<string>();
  private pendingPtySessions = new Set<string>();
  private ptySessionPromises = new Map<string, Promise<void>>();
  private ptyBufferBySession = new Map<string, string>();
  private activeConnectionRuntimes = new Map<string, ActiveConnectionRuntime>();
  private _shouldScroll = false;
  private scrollFramePending = false;
  get shouldScroll(): boolean {
    return this._shouldScroll;
  }

  set shouldScroll(value: boolean) {
    this._shouldScroll = value;
    if (value) {
      this.scheduleScrollToBottom();
    }
  }


  isSshSessionActive: boolean = false;
  currentSshUserHost: string | null = null;

  constructor(
    private sanitizer: DomSanitizer,
    private aiCommandService: AiCommandService,
    private aiResponseFormatService: AiResponseFormatService,
    private connectionProfileService: ConnectionProfileService,
    private openAiConnectionService: OpenAiCompatibleConnectionService,
    private terminalSessionService: TerminalSessionService
  ) { }


  // Public method to sanitize HTML content
  public sanitizeHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private loadAiSettings(): void {
    const storedSettings = localStorage.getItem(this.aiSettingsStorageKey);
    if (!storedSettings) {
      return;
    }

    try {
      const parsed = JSON.parse(storedSettings) as StoredAiSettings;
      this.aiApiBaseUrl = this.openAiConnectionService.normalizeBaseUrl(
        parsed.apiBaseUrl || this.aiApiBaseUrl
      );
      this.aiApiKey = parsed.apiKey || '';
      this.currentLLMModel = parsed.currentModel || '';
      this.availableModels = Array.isArray(parsed.availableModels) ? parsed.availableModels : [];
    } catch (error) {
      console.error('Failed to load AI settings:', error);
      this.aiSettingsStatus = 'Could not load saved AI settings.';
    }
  }

  saveAiSettings(): void {
    this.aiApiBaseUrl = this.openAiConnectionService.normalizeBaseUrl(this.aiApiBaseUrl);
    const settings: StoredAiSettings = {
      apiBaseUrl: this.aiApiBaseUrl,
      apiKey: this.aiApiKey,
      currentModel: this.currentLLMModel,
      availableModels: this.availableModels
    };
    localStorage.setItem(this.aiSettingsStorageKey, JSON.stringify(settings));
    this.aiSettingsStatus = 'Settings saved.';
  }

  setActiveAiView(view: 'chat' | 'settings'): void {
    this.activeAiView = view;
  }

  onModelSelected(model: string): void {
    if (!model) {
      return;
    }
    this.currentLLMModel = model;
    this.saveAiSettings();
    this.aiSettingsStatus = `Using model: ${model}`;
  }

  async loadAvailableModels(): Promise<void> {
    if (!this.aiApiKey.trim()) {
      this.aiSettingsStatus = 'Enter an API key before loading models.';
      return;
    }

    this.isLoadingModels = true;
    this.aiSettingsStatus = 'Loading models...';
    try {
      this.aiApiBaseUrl = this.openAiConnectionService.normalizeBaseUrl(this.aiApiBaseUrl);
      const models = await this.openAiConnectionService.loadModels(this.aiApiBaseUrl, this.aiApiKey);
      this.availableModels = models;
      if (!this.currentLLMModel && models.length > 0) {
        this.currentLLMModel = models[0];
      }
      this.saveAiSettings();
      this.aiSettingsStatus = models.length > 0
        ? `Loaded ${models.length} model${models.length === 1 ? '' : 's'}.`
        : 'Connected, but no models were returned.';
    } catch (error: any) {
      console.error('Failed to load models:', error);
      this.aiSettingsStatus = `Failed to load models: ${error.message || error}`;
    } finally {
      this.isLoadingModels = false;
    }
  }

  async ngOnInit() {
    this.loadAiSettings();
    this.loadConnectionProfiles();

    // Initialize first terminal session
    this.createNewSession('Terminal 1', true);

    // Clean any existing code blocks to ensure no backticks are displayed
    this.sanitizeAllCodeBlocks();
  }

  ngAfterViewInit(): void {
    this.initializeInteractiveTerminal();
    this.resizeInteractiveTerminal();
  }

  private initializeInteractiveTerminal(): void {
    if (!this.terminalContainerRef?.nativeElement || this.terminal) {
      return;
    }

    this.fitAddon = new FitAddon();
    this.terminal = new Terminal({
      fontFamily: '"JetBrains Mono", "Menlo", "Monaco", "Courier New", monospace',
      fontSize: 12,
      fontWeight: '300',
      fontWeightBold: '500',
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      scrollback: 5000,
      convertEol: false,
      theme: {
        background: '#0f1115',
        foreground: '#e6edf3',
        cursor: '#7aa2f7'
      }
    });
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalContainerRef.nativeElement);
    this.fitAddon.fit();

    this.terminal.onData((data: string) => {
      if (!this.activeSessionId) {
        return;
      }
      invoke<void>('pty_write', { sessionId: this.activeSessionId, data })
        .catch((error) => {
          console.error('Failed to write to PTY:', error);
        });
    });

    this.terminal.onResize(({ cols, rows }) => {
      if (!this.activeSessionId) {
        return;
      }
      invoke<void>('pty_resize', { sessionId: this.activeSessionId, cols, rows })
        .catch((error) => {
          console.error('Failed to resize PTY:', error);
        });
    });

    void this.registerPtyListeners();
    if (this.activeSessionId) {
      void this.ensurePtySession(this.activeSessionId);
    }
  }

  private async registerPtyListeners(): Promise<void> {
    const unlistenPtyOutput = await listen('pty_output', (event) => {
      const payload = event.payload as { sessionId: string; data: string };

      const previous = this.ptyBufferBySession.get(payload.sessionId) || '';
      this.ptyBufferBySession.set(payload.sessionId, previous + payload.data);

      void this.handleConnectionAutomation(payload.sessionId);

      if (payload.sessionId === this.activeSessionId && this.terminal) {
        this.terminal.write(payload.data);
      }
    });

    const unlistenPtyExit = await listen('pty_exit', (event) => {
      const payload = event.payload as { sessionId: string; success: boolean };
      this.ptySessions.delete(payload.sessionId);
      this.pendingPtySessions.delete(payload.sessionId);
      this.ptySessionPromises.delete(payload.sessionId);
      this.activeConnectionRuntimes.delete(payload.sessionId);
    });

    this.unlistenFunctions.push(unlistenPtyOutput, unlistenPtyExit);
  }

  private async ensurePtySession(sessionId: string): Promise<void> {
    if (!this.terminal || this.ptySessions.has(sessionId)) {
      return;
    }

    const pendingSession = this.ptySessionPromises.get(sessionId);
    if (pendingSession) {
      return pendingSession;
    }

    const cols = this.terminal.cols || 80;
    const rows = this.terminal.rows || 24;
    this.pendingPtySessions.add(sessionId);

    const createSession = (async () => {
      await invoke<void>('pty_create_session', { sessionId, cols, rows });
      this.ptySessions.add(sessionId);
      if (!this.ptyBufferBySession.has(sessionId)) {
        this.ptyBufferBySession.set(sessionId, '');
      }
    })();

    this.ptySessionPromises.set(sessionId, createSession);

    try {
      await createSession;
    } finally {
      this.pendingPtySessions.delete(sessionId);
      this.ptySessionPromises.delete(sessionId);
    }
  }

  private renderActivePtyBuffer(): void {
    if (!this.terminal || !this.activeSessionId) {
      return;
    }

    const sessionBuffer = this.ptyBufferBySession.get(this.activeSessionId) || '';
    this.terminal.reset();
    if (sessionBuffer.length > 0) {
      this.terminal.write(sessionBuffer);
    }
  }

  private resizeInteractiveTerminal(): void {
    if (!this.terminal || !this.fitAddon) {
      return;
    }
    this.fitAddon.fit();
    const cols = this.terminal.cols || 80;
    const rows = this.terminal.rows || 24;
    if (!this.activeSessionId) {
      return;
    }
    invoke<void>('pty_resize', { sessionId: this.activeSessionId, cols, rows })
      .catch((error) => {
        console.error('Failed to resize active PTY:', error);
      });
  }

  ngOnDestroy() {
    for (const sessionId of this.ptySessions) {
      invoke<void>('pty_close_session', { sessionId }).catch(() => {
        // Ignore close failures during shutdown.
      });
    }
    this.pendingPtySessions.clear();
    this.ptySessionPromises.clear();
    this.activeConnectionRuntimes.clear();
    this.terminal?.dispose();
    this.fitAddon = null;
    this.terminal = null;
    // Clean up all event listeners
    for (const unlisten of this.unlistenFunctions) {
      unlisten();
    }
  }

  private scheduleScrollToBottom() {
    if (!this.shouldScroll || this.scrollFramePending) {
      return;
    }

    this.scrollFramePending = true;
    requestAnimationFrame(() => {
      this.scrollToBottom();
      this.shouldScroll = false;
      this.scrollFramePending = false;
    });
  }

  private scrollToBottom() {
    document.querySelectorAll('.output-area').forEach((area) => {
      const outputArea = area as HTMLElement;
      outputArea.scrollTop = outputArea.scrollHeight;
    });
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.isResizing) {
      const diff = event.clientX - this.startX;
      const newWidth = this.startWidth + diff;
      this.leftPanelWidth = Math.min(
        Math.max(200, newWidth),
        window.innerWidth * 0.8
      );
      this.resizeInteractiveTerminal();
    }
  }

  @HostListener('document:touchmove', ['$event'])
  onTouchMove(event: TouchEvent) {
    if (this.isResizing) {
      event.preventDefault(); // Prevent scrolling during resize
      const diff = event.touches[0].clientX - this.startX;
      const newWidth = this.startWidth + diff;
      this.leftPanelWidth = Math.min(
        Math.max(200, newWidth),
        window.innerWidth * 0.8
      );
      this.resizeInteractiveTerminal();
    }
  }

  @HostListener('document:mouseup')
  onMouseUp() {
    this.isResizing = false;
    this.resizeInteractiveTerminal();
  }

  @HostListener('document:touchend')
  onTouchEnd() {
    this.isResizing = false;
    this.resizeInteractiveTerminal();
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.resizeInteractiveTerminal();
  }

  // Handle key presses globally
  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(_event: KeyboardEvent) {
    // Interactive mode handles keys directly through xterm onData.
  }

  startResize(event: MouseEvent | TouchEvent) {
    this.isResizing = true;
    this.startX = event instanceof MouseEvent ? event.clientX : event.touches[0].clientX;
    this.startWidth = this.leftPanelWidth;
  }

  autoResize(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  // Add a new method to parse commands from AI responses
  parseCommandFromResponse(response: string): { command: string, fullText: string }[] {
    return this.aiResponseFormatService.parseCommandFromResponse(response);
  }

  // Extract code blocks from response text
  extractCodeBlocks(text: string): { formattedText: string, codeBlocks: { code: string, language: string }[] } {
    return this.aiResponseFormatService.extractCodeBlocks(text);
  }

  // Handle code copy button click
  copyCodeBlock(code: string): void {
    this.copyToClipboard(code);

    // Show a brief "Copied!" notification
    this.showCopiedNotification();
  }

  // Add visual feedback when copying
  showCopiedNotification(): void {
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'Copied!';
    document.body.appendChild(notification);

    // Animate and remove
    setTimeout(() => {
      notification.classList.add('show');
      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 300);
      }, 1200);
    }, 10);
  }

  // Check if a code block is a simple command (no special formatting needed)
  isSimpleCommand(code: string): boolean {
    return this.aiResponseFormatService.isSimpleCommand(code);
  }

  // Calls an OpenAI-compatible Chat Completions endpoint with terminal context.
  async callOpenAiCompatibleApi(question: string, model: string): Promise<string> {
    try {
      if (!this.aiApiKey.trim()) {
        return 'Error: OpenAI compatible API key is not configured. Open Settings and add a key.';
      }

      if (!model.trim()) {
        return 'Error: No model is selected. Open Settings, enter a model, or load models from your endpoint.';
      }

      // Get the current operating system
      const os = this.detectOperatingSystem();

      const systemPrompt = buildTerminalAssistantSystemPrompt(os);

      // Build messages array with conversation context.
      const messages: { role: string; content: string }[] = [
        { role: 'system', content: systemPrompt }
      ];

      // Add previous chat history (exclude the current pending "Thinking..." entry)
      const completedChatHistory = this.chatHistory.slice(0, -1);
      for (const entry of completedChatHistory) {
        if (entry.response && entry.response !== 'Thinking...') {
          messages.push({ role: 'user', content: entry.message });
          messages.push({ role: 'assistant', content: entry.response });
        }
      }

      // Get current folder (try backend for fresher value, fallback to session state)
      let currentFolder = this.currentWorkingDirectory || '~';
      if (this.activeSessionId) {
        try {
          const cwd = await invoke<string>('get_working_directory', {
            sessionId: this.activeSessionId
          });
          if (cwd?.trim()) {
            currentFolder = cwd;
          }
        } catch {
          // Keep currentWorkingDirectory fallback
        }
      }

      // Build the current user message with context (folder, commands, question)
      const contextParts: string[] = [];
      contextParts.push(`Current folder: ${currentFolder}`);
      const lastCommands = this.commandHistory
        .filter(c => c.command?.trim())
        .slice(-4)
        .map(c => c.command.trim());
      if (lastCommands.length > 0) {
        contextParts.push(`Recent terminal commands (last ${lastCommands.length}):\n${lastCommands.map(c => `  $ ${c}`).join('\n')}`);
      }
      contextParts.push(`Current question: ${question}`);
      const userContent = contextParts.join('\n\n');
      messages.push({ role: 'user', content: userContent });

      const requestBody = {
        model: model,
        messages,
        stream: false
      };

      const normalizedBaseUrl = this.openAiConnectionService.normalizeBaseUrl(this.aiApiBaseUrl);
      const apiEndpoint = `${normalizedBaseUrl}/chat/completions`;

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.aiApiKey.trim()}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI compatible API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.error('Unexpected response format:', data);
        return 'Error: Unexpected response format from OpenAI compatible API';
      }

      return content;
    } catch (error: any) {

      // Add more specific error messages for different failure types
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return `Error: Could not connect to OpenAI compatible API at ${this.aiApiBaseUrl}. Check the endpoint and network connection.`;
      }

      return `Error: ${error.message || 'Unknown error calling OpenAI compatible API'}`;
    }
  }

  private detectOperatingSystem(): string {
    const platform = navigator.platform.toLowerCase();
    const userAgent = navigator.userAgent.toLowerCase();

    if (platform.includes('win') || userAgent.includes('windows')) {
      return 'Windows';
    }

    if (platform.includes('mac')) {
      return 'macOS';
    }

    return 'Linux';
  }

  async askAI(event: KeyboardEvent): Promise<void> {
    // Skip if not Enter key or Shift+Enter held (for newlines)
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();

    // Skip if no question or currently processing
    if (!this.currentQuestion.trim() || this.isProcessingAI) {
      return;
    }

    // Handle commands (starting with /)
    const isCommand = this.currentQuestion.startsWith('/');
    let response = '';

    this.isProcessingAI = true;

    try {
      // Add to chat history immediately to show pending state
      const chatEntry: ChatHistory = {
        message: this.currentQuestion,
        response: "Thinking...",
        timestamp: new Date(),
        isCommand: isCommand
      };

      this.chatHistory.push(chatEntry);
      this.shouldScroll = true;

      if (isCommand) {
        response = await this.handleAICommand(this.currentQuestion);
      } else {
        response = await this.callOpenAiCompatibleApi(this.currentQuestion, this.currentLLMModel);

        // Check if the response contains a command we can execute
        const commandParts = this.parseCommandFromResponse(response);
        const hasCommands = commandParts.some(part => part.command);
        if (hasCommands) {
          // If this is a direct shell command question, we can enhance the UI by marking it as a command
          chatEntry.isCommand = true;
        }
      }

      // Use the new method to process the response
      this.processNewChatEntry(chatEntry, response);

      // Clear current question and scroll to bottom
      this.currentQuestion = '';
      this.shouldScroll = true;
    } catch (error) {
      console.error('Failed to process AI request:', error);
      this.chatHistory[this.chatHistory.length - 1].response = `Error: ${error}`;
    } finally {
      this.isProcessingAI = false;
    }
  }

  async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  }

  // Code specific functions
  isCodeBlockPlaceholder(text: string): boolean {
    return this.aiResponseFormatService.isCodeBlockPlaceholder(text);
  }

  getCodeBlockIndex(placeholder: string): number {
    return this.aiResponseFormatService.getCodeBlockIndex(placeholder);
  }

  // Handle AI commands starting with /
  async handleAICommand(command: string): Promise<string> {
    return this.aiCommandService.handleAICommand(command, {
      currentLLMModel: this.currentLLMModel,
      apiBaseUrl: this.aiApiBaseUrl,
      apiKey: this.aiApiKey,
      availableModels: this.availableModels,
      setCurrentLLMModel: (model: string) => {
        this.currentLLMModel = model;
      },
      setApiBaseUrl: (host: string) => {
        this.aiApiBaseUrl = this.openAiConnectionService.normalizeBaseUrl(host);
        return this.aiApiBaseUrl;
      },
      setAvailableModels: (models: string[]) => {
        this.availableModels = models;
      },
      loadModels: async () => {
        const models = await this.openAiConnectionService.loadModels(this.aiApiBaseUrl, this.aiApiKey);
        this.availableModels = models;
        this.saveAiSettings();
        return models;
      },
      saveSettings: () => {
        this.saveAiSettings();
      },
      clearChatHistory: () => {
        this.chatHistory = [];
      },
      testOpenAiConnection: () => {
        void this.testOpenAiConnection();
      },
      retryOpenAiConnection: async () => this.retryOpenAiConnection()
    });
  }

  // Method to get command explanation from code block
  getCommandExplanation(code: string): string | null {
    return this.aiResponseFormatService.getCommandExplanation(code);
  }

  // Update transformCodeForDisplay to handle explanations
  transformCodeForDisplay(code: string): string {
    return this.aiResponseFormatService.transformCodeForDisplay(code);
  }

  // Make sure all code blocks in the chat history are properly sanitized
  sanitizeAllCodeBlocks(): void {
    // Go through all chat history entries
    for (const entry of this.chatHistory) {
      // Skip entries without code blocks
      if (!entry.codeBlocks || entry.codeBlocks.length === 0) {
        continue;
      }

      // Sanitize each code block to remove backticks
      for (const codeBlock of entry.codeBlocks) {
        codeBlock.code = this.transformCodeForDisplay(codeBlock.code);
      }
    }
  }

  // Process newly added chat entry
  processNewChatEntry(entry: ChatHistory, response: string): void {
    // Process the response to extract code blocks
    const { formattedText, codeBlocks } = this.extractCodeBlocks(response);

    // Sanitize all code blocks to remove backticks
    for (const codeBlock of codeBlocks) {
      codeBlock.code = this.transformCodeForDisplay(codeBlock.code);
    }

    // Update the chat entry
    entry.response = formattedText;
    entry.codeBlocks = codeBlocks;
  }

  // Helper method to focus the terminal textarea
  focusTerminalInput(): void {
    if (this.terminal) {
      this.terminal.focus();
      return;
    }
  }

  async testOpenAiConnection(): Promise<void> {
    await this.openAiConnectionService.testOpenAiConnection({
      apiBaseUrl: this.aiApiBaseUrl,
      apiKey: this.aiApiKey,
      currentLLMModel: this.currentLLMModel,
      setCurrentLLMModel: (model: string) => {
        this.currentLLMModel = model;
      },
      setAvailableModels: (models: string[]) => {
        this.availableModels = models;
        this.saveAiSettings();
      },
      addChatEntry: (entry: ChatHistory) => {
        this.chatHistory.push(entry);
      }
    });
  }

  async retryOpenAiConnection(): Promise<void> {
    await this.openAiConnectionService.retryOpenAiConnection({
      apiBaseUrl: this.aiApiBaseUrl,
      apiKey: this.aiApiKey,
      currentLLMModel: this.currentLLMModel,
      setCurrentLLMModel: (model: string) => {
        this.currentLLMModel = model;
      },
      setAvailableModels: (models: string[]) => {
        this.availableModels = models;
        this.saveAiSettings();
      },
      addChatEntry: (entry: ChatHistory) => {
        this.chatHistory.push(entry);
      }
    });
  }

  private loadConnectionProfiles(): void {
    this.connectionProfiles = this.connectionProfileService.listProfiles();
  }

  openConnectionManager(): void {
    this.loadConnectionProfiles();
    this.isConnectionManagerOpen = true;
  }

  closeConnectionManager(): void {
    this.isConnectionManagerOpen = false;
    this.isConnectionFormOpen = false;
  }

  closeConnectionForm(): void {
    this.isConnectionFormOpen = false;
  }

  startNewConnectionProfile(): void {
    this.connectionFormMode = 'create';
    this.editingConnectionProfileId = '';
    this.connectionForm = this.createEmptyConnectionForm();
    this.connectionStatus = '';
    this.isConnectionFormOpen = true;
  }

  editConnectionProfile(profile: ConnectionProfile): void {
    this.connectionFormMode = 'edit';
    this.editingConnectionProfileId = profile.id;
    this.connectionForm = this.profileToForm(profile);
    this.connectionStatus = `Editing ${profile.name}`;
    this.isConnectionFormOpen = true;
  }

  saveConnectionProfile(): void {
    const payload = this.formToProfileInput();
    if (!payload.name?.trim()) {
      this.connectionStatus = 'Connection name is required.';
      return;
    }

    if (this.connectionFormMode === 'edit' && this.editingConnectionProfileId) {
      const updatedProfile = this.connectionProfileService.updateProfile(
        this.editingConnectionProfileId,
        payload
      );
      this.loadConnectionProfiles();
      this.connectionStatus = updatedProfile
        ? `Saved ${updatedProfile.name}.`
        : 'Connection profile was not found.';
      if (updatedProfile) {
        this.isConnectionFormOpen = false;
      }
      return;
    }

    const createdProfile = this.connectionProfileService.createProfile(
      payload as CreateConnectionProfileInput
    );
    this.loadConnectionProfiles();
    this.connectionFormMode = 'edit';
    this.editingConnectionProfileId = createdProfile.id;
    this.connectionForm = this.profileToForm(createdProfile);
    this.connectionStatus = `Created ${createdProfile.name}.`;
    this.isConnectionFormOpen = false;
  }

  duplicateConnectionProfile(profile: ConnectionProfile): void {
    const duplicatedProfile = this.connectionProfileService.duplicateProfile(profile.id);
    this.loadConnectionProfiles();
    if (!duplicatedProfile) {
      this.connectionStatus = 'Connection profile was not found.';
      return;
    }

    this.editConnectionProfile(duplicatedProfile);
    this.connectionStatus = `Duplicated ${profile.name}.`;
  }

  deleteConnectionProfile(profile: ConnectionProfile): void {
    const confirmed = window.confirm(`Delete connection profile "${profile.name}"?`);
    if (!confirmed) {
      return;
    }

    const deleted = this.connectionProfileService.deleteProfile(profile.id);
    this.loadConnectionProfiles();
    if (this.editingConnectionProfileId === profile.id) {
      this.isConnectionFormOpen = false;
      this.editingConnectionProfileId = '';
      this.connectionFormMode = 'create';
      this.connectionForm = this.createEmptyConnectionForm();
    }
    this.connectionStatus = deleted ? `Deleted ${profile.name}.` : 'Connection profile was not found.';
  }

  async connectConnectionProfile(profile: ConnectionProfile): Promise<void> {
    if (profile.type !== 'ssh') {
      this.connectionStatus = 'JumpServer connection will be implemented in task 04.';
      return;
    }

    const displayName = this.generateConnectionDisplayName(profile);
    let sessionId = '';

    try {
      const sshCommand = this.buildSshCommand(profile);
      sessionId = this.createNewSession(displayName, true, profile.id);
      this.registerActiveConnectionRuntime(sessionId, profile);
      await this.ensurePtySession(sessionId);
      await invoke<void>('pty_write', {
        sessionId,
        data: this.withTerminalSubmitSequence(sshCommand)
      });
      this.markSessionConnected(sessionId, profile);
      this.connectionProfileService.markConnected(profile.id);
      this.loadConnectionProfiles();
      this.connectionStatus = `Connecting ${displayName}.`;
      this.isConnectionManagerOpen = false;
      this.isConnectionFormOpen = false;
    } catch (error: any) {
      this.connectionStatus = `Failed to connect ${displayName}: ${error.message || error}`;
      if (sessionId) {
        this.activeConnectionRuntimes.delete(sessionId);
      }
      if (sessionId) {
        console.error(`Failed to connect profile ${profile.id} in session ${sessionId}:`, error);
      } else {
        console.error(`Failed to connect profile ${profile.id}:`, error);
      }
    }
  }

  private registerActiveConnectionRuntime(sessionId: string, profile: ConnectionProfile): void {
    this.activeConnectionRuntimes.set(sessionId, {
      terminalSessionId: sessionId,
      profileId: profile.id,
      profileType: profile.type,
      passwordAttempted: false,
      firedAutoInputRuleIds: [],
      createdAt: new Date().toISOString()
    });
  }

  private async handleConnectionAutomation(sessionId: string): Promise<void> {
    const runtime = this.activeConnectionRuntimes.get(sessionId);
    if (!runtime) {
      return;
    }

    await this.handlePasswordPromptAutomation(runtime);
  }

  private async handlePasswordPromptAutomation(runtime: ActiveConnectionRuntime): Promise<void> {
    if (runtime.passwordAttempted) {
      return;
    }

    const profile = this.connectionProfileService.getProfile(runtime.profileId);
    if (!profile || profile.authMethod !== 'password') {
      return;
    }

    const password = this.getConnectionPassword(profile);
    if (!password) {
      return;
    }

    const outputTail = this.getPtyOutputTail(runtime.terminalSessionId);
    if (!this.hasPasswordPrompt(outputTail)) {
      return;
    }

    runtime.passwordAttempted = true;
    try {
      await invoke<void>('pty_write', {
        sessionId: runtime.terminalSessionId,
        data: this.withTerminalSubmitSequence(password)
      });
    } catch (error) {
      console.error(`Failed to submit SSH password for session ${runtime.terminalSessionId}:`, error);
    }
  }

  private getConnectionPassword(profile: ConnectionProfile): string | undefined {
    if (profile.type === 'jumpserver') {
      return profile.jumpPassword || profile.targetPassword;
    }

    return profile.targetPassword;
  }

  private getPtyOutputTail(sessionId: string): string {
    const output = this.ptyBufferBySession.get(sessionId) || '';
    return output.slice(-4000);
  }

  private hasPasswordPrompt(output: string): boolean {
    const normalizedOutput = output
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u0007/g, '');
    return /(?:password|passphrase|密码)[^:\n\r]*[:：][\s\u0000-\u001f]*$/i.test(normalizedOutput);
  }

  buildSshCommand(profile: ConnectionProfile): string {
    const host = profile.targetHost?.trim();
    if (!host) {
      throw new Error('Target host is required for SSH connections.');
    }

    const commandParts = ['ssh'];
    if (profile.authMethod === 'privateKey' && profile.privateKeyPath?.trim()) {
      commandParts.push('-i', this.quoteShellArg(profile.privateKeyPath.trim()));
    }

    if (profile.targetPort) {
      commandParts.push('-p', String(profile.targetPort));
    }

    const user = profile.targetUser?.trim();
    commandParts.push(user ? `${user}@${host}` : host);
    return commandParts.join(' ');
  }

  private quoteShellArg(value: string): string {
    if (/^[A-Za-z0-9_@%+=:,./\\~-]+$/.test(value)) {
      return value;
    }

    if (this.detectOperatingSystem() === 'Windows') {
      return `'${value.replace(/'/g, "''")}'`;
    }

    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  private markSessionConnected(sessionId: string, profile: ConnectionProfile): void {
    const userHost = this.getSshUserHost(profile);
    this.terminalSessions = this.terminalSessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            connectionProfileId: profile.id,
            isSshSessionActive: true,
            currentSshUserHost: userHost
          }
        : session
    );

    if (this.activeSessionId === sessionId) {
      this.isSshSessionActive = true;
      this.currentSshUserHost = userHost;
    }
  }

  private getSshUserHost(profile: ConnectionProfile): string {
    const host = profile.targetHost?.trim() || '';
    const user = profile.targetUser?.trim();
    return user ? `${user}@${host}` : host;
  }

  addAutoInputRule(): void {
    this.connectionForm.autoInputRules = [
      ...this.connectionForm.autoInputRules,
      {
        id: this.createClientId('rule'),
        whenOutputMatches: '',
        input: '',
        appendEnter: true,
        enabled: true
      }
    ];
  }

  removeAutoInputRule(ruleId: string): void {
    this.connectionForm.autoInputRules = this.connectionForm.autoInputRules.filter(
      (rule) => rule.id !== ruleId
    );
  }

  generateConnectionDisplayName(profile: ConnectionProfile): string {
    return this.connectionProfileService.generateConnectionDisplayName(profile);
  }

  getConnectionTypeLabel(type: ConnectionProfileType): string {
    return type === 'jumpserver' ? 'JumpServer' : 'SSH';
  }

  formatConnectionTime(value?: string): string {
    if (!value) {
      return 'Never';
    }

    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      return 'Unknown';
    }

    return timestamp.toLocaleString();
  }

  trackByConnectionProfileId(_: number, profile: ConnectionProfile): string {
    return profile.id;
  }

  trackByAutoInputRuleId(_: number, rule: AutoInputRule): string {
    return rule.id;
  }

  private createEmptyConnectionForm(): ConnectionProfileForm {
    return {
      name: '',
      type: 'ssh',
      jumpHost: '',
      jumpPort: '',
      jumpUser: '',
      jumpPassword: '',
      targetHost: '',
      targetPort: '22',
      targetUser: '',
      targetPassword: '',
      authMethod: 'password',
      privateKeyPath: '',
      autoInputRules: [],
      tagsText: '',
      description: ''
    };
  }

  private profileToForm(profile: ConnectionProfile): ConnectionProfileForm {
    return {
      name: profile.name,
      type: profile.type,
      jumpHost: profile.jumpHost || '',
      jumpPort: this.portToString(profile.jumpPort),
      jumpUser: profile.jumpUser || '',
      jumpPassword: profile.jumpPassword || '',
      targetHost: profile.targetHost || '',
      targetPort: this.portToString(profile.targetPort),
      targetUser: profile.targetUser || '',
      targetPassword: profile.targetPassword || '',
      authMethod: profile.authMethod,
      privateKeyPath: profile.privateKeyPath || '',
      autoInputRules: profile.autoInputRules.map((rule) => ({ ...rule })),
      tagsText: profile.tags.join(', '),
      description: profile.description || ''
    };
  }

  private formToProfileInput(): CreateConnectionProfileInput | UpdateConnectionProfilePatch {
    return {
      name: this.connectionForm.name,
      type: this.connectionForm.type,
      jumpHost: this.emptyToUndefined(this.connectionForm.jumpHost),
      jumpPort: this.parseOptionalPort(this.connectionForm.jumpPort),
      jumpUser: this.emptyToUndefined(this.connectionForm.jumpUser),
      jumpPassword: this.rawEmptyToUndefined(this.connectionForm.jumpPassword),
      targetHost: this.emptyToUndefined(this.connectionForm.targetHost),
      targetPort: this.parseOptionalPort(this.connectionForm.targetPort),
      targetUser: this.emptyToUndefined(this.connectionForm.targetUser),
      targetPassword: this.rawEmptyToUndefined(this.connectionForm.targetPassword),
      authMethod: this.connectionForm.authMethod,
      privateKeyPath: this.emptyToUndefined(this.connectionForm.privateKeyPath),
      autoInputRules: this.connectionForm.autoInputRules.map((rule) => ({ ...rule })),
      tags: this.connectionForm.tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
      description: this.emptyToUndefined(this.connectionForm.description)
    };
  }

  private parseOptionalPort(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const port = Number(trimmed);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  }

  private portToString(value?: number): string {
    return typeof value === 'number' ? String(value) : '';
  }

  private emptyToUndefined(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private rawEmptyToUndefined(value: string): string | undefined {
    return value.length > 0 ? value : undefined;
  }

  private createClientId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private withTerminalSubmitSequence(command: string): string {
    return `${command}${this.getTerminalSubmitSequence()}`;
  }

  private getTerminalSubmitSequence(): string {
    return this.detectOperatingSystem() === 'Windows' ? '\r' : '\n';
  }

  // Method to copy code to terminal input (adds to prompt for editing, does not execute)
  sendCodeToTerminal(code: string): void {
    const command = this.transformCodeForDisplay(code);
    if (this.activeSessionId) {
      invoke<void>('pty_write', { sessionId: this.activeSessionId, data: command }).catch((error) => {
        console.error('Failed to send command to PTY:', error);
      });
    }
    this.focusTerminalInput();

    // Show a brief notification
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'Copied to terminal';
    document.body.appendChild(notification);

    // Animate and remove notification
    setTimeout(() => {
      notification.classList.add('show');
      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 300);
      }, 1200);
    }, 10);
  }

  // Method to execute code directly
  executeCodeDirectly(code: string): void {
    const command = this.transformCodeForDisplay(code);
    const commandWithSubmit = this.withTerminalSubmitSequence(command);
    if (this.activeSessionId) {
      invoke<void>('pty_write', { sessionId: this.activeSessionId, data: commandWithSubmit }).catch((error) => {
        console.error('Failed to execute command in PTY:', error);
      });
      // Track command in history for LLM context
      this.commandHistory.push({
        command,
        output: [],
        timestamp: new Date(),
        isComplete: true
      });
    }

    // Toggle to the terminal panel if we're on mobile
    if (window.innerWidth < 768) {
      this.isAIPanelVisible = false;
    }
  }

  toggleAIPanel(): void {
    this.isAIPanelVisible = !this.isAIPanelVisible;
    if (this.terminal && this.fitAddon) {
      setTimeout(() => this.fitAddon!.fit(), 0);
    }
  }

  // Session Management Methods
  createNewSession(
    name?: string,
    setAsActive: boolean = false,
    connectionProfileId?: string
  ): string {
    const { sessions, sessionId, shouldActivate } = this.terminalSessionService.createNewSession(
      this.terminalSessions,
      name,
      setAsActive,
      connectionProfileId
    );
    this.terminalSessions = sessions;

    if (shouldActivate) {
      this.switchToSession(sessionId);
    } else if (this.terminal) {
      void this.ensurePtySession(sessionId);
    }

    return sessionId;
  }

  switchToSession(sessionId: string): void {
    // Save current session state
    if (this.activeSessionId) {
      this.saveCurrentSessionState();
    }

    const { sessions, targetSession } = this.terminalSessionService.switchToSession(
      this.terminalSessions,
      sessionId
    );
    this.terminalSessions = sessions;

    if (!targetSession) {
      return;
    }

    this.activeSessionId = sessionId;

    // Restore session state
    this.restoreSessionState(targetSession);
    if (this.terminal) {
      void this.ensurePtySession(sessionId).then(() => {
        this.renderActivePtyBuffer();
        this.resizeInteractiveTerminal();
      }).catch((error) => {
        console.error(`Failed to initialize PTY for ${sessionId}:`, error);
      });
    }
  }

  closeSession(sessionId: string): void {
    const { sessions, nextActiveSessionId } = this.terminalSessionService.closeSession(
      this.terminalSessions,
      sessionId
    );

    const sessionWasRemoved = sessions.length < this.terminalSessions.length;
    this.terminalSessions = sessions;

    if (sessionWasRemoved) {
      void invoke<void>('pty_close_session', { sessionId }).catch((error) => {
        console.error(`Failed to close PTY session ${sessionId}:`, error);
      });
      this.ptySessions.delete(sessionId);
      this.pendingPtySessions.delete(sessionId);
      this.ptySessionPromises.delete(sessionId);
      this.activeConnectionRuntimes.delete(sessionId);
      this.ptyBufferBySession.delete(sessionId);
    }

    if (nextActiveSessionId) {
      this.switchToSession(nextActiveSessionId);
    }
  }

  renameSession(sessionId: string, newName: string): void {
    this.terminalSessions = this.terminalSessionService.renameSession(
      this.terminalSessions,
      sessionId,
      newName
    );
  }

  private saveCurrentSessionState(): void {
    this.terminalSessions = this.terminalSessionService.saveCurrentSessionState(
      this.terminalSessions,
      this.activeSessionId,
      {
        commandHistory: this.commandHistory,
        currentWorkingDirectory: this.currentWorkingDirectory,
        gitBranch: this.gitBranch,
        isSshSessionActive: this.isSshSessionActive,
        currentSshUserHost: this.currentSshUserHost
      }
    );
  }

  private restoreSessionState(session: TerminalSession): void {
    const state = this.terminalSessionService.restoreSessionState(session);
    this.commandHistory = state.commandHistory;
    this.currentWorkingDirectory = state.currentWorkingDirectory;
    this.gitBranch = state.gitBranch;
    this.isSshSessionActive = state.isSshSessionActive;
    this.currentSshUserHost = state.currentSshUserHost;
  }

  trackBySessionId(_: number, session: TerminalSession): string {
    return session.id;
  }

  trackByChatEntry(index: number, entry: ChatHistory): string {
    return `${entry.timestamp.getTime()}-${index}`;
  }

  trackByResponseSegment(index: number, segment: string): string {
    return `${index}-${segment}`;
  }
}
