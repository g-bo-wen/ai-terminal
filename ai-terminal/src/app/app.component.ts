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
import { AiCodeBlock, AiConversation, AiMessage } from './models/ai-conversation.model';
import { ChatHistory } from './models/chat-history.model';
import { CommandExecution } from './models/command-execution.model';
import { CommandSuggestion } from './models/command-suggestion.model';
import {
  AutoInputRule,
  ConnectionAuthMethod,
  ConnectionProfile,
  ConnectionProfileType,
  CreateConnectionProfileInput,
  UpdateConnectionProfilePatch
} from './models/connection-profile.model';
import { TerminalConnectionState, TerminalSession } from './models/terminal-session.model';
import {
  TerminalProfileKind,
  TerminalProfileViewItem,
  WslDistribution
} from './models/terminal-profile.model';
import { TerminalTabComponent } from './components/terminal-tab/terminal-tab.component';
import { IconComponent } from './components/icon/icon.component';
import { AiCommandService } from './services/ai-command.service';
import { AiChatLogService } from './services/ai-chat-log.service';
import { AiConversationService } from './services/ai-conversation.service';
import { AiResponseFormatService } from './services/ai-response-format.service';
import { ConnectionProfileService } from './services/connection-profile.service';
import { OpenAiCompatibleConnectionService } from './services/open-ai-compatible-connection.service';
import { TerminalSessionService } from './services/terminal-session.service';
import { ConnectionCommandService } from './services/connection-command.service';
import { ConnectionProbeLogicService } from './services/connection-probe-logic.service';
import { CommandExecutionFormatService } from './services/command-execution-format.service';
import { CommandTagParserService, ParsedCommandTag } from './services/command-tag-parser.service';
import { CommandRiskPolicyService } from './services/command-risk-policy.service';
import {
  buildTerminalAssistantSystemPrompt,
  TerminalAssistantEnvironmentContext
} from './constants/ai.constants';

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
  jumpPort: string | number;
  jumpUser: string;
  jumpPassword: string;
  targetHost: string;
  targetPort: string | number;
  targetUser: string;
  targetPassword: string;
  authMethod: ConnectionAuthMethod;
  privateKeyPath: string;
  privateKeyPassphrase: string;
  autoInputRules: AutoInputRule[];
  tagsText: string;
  description: string;
  serverContext: string;
  serverContextPath: string;
  probeRawOutput: string;
  probeUpdatedAt: string;
}

interface ActiveConnectionRuntime {
  terminalSessionId: string;
  profileId: string;
  profileType: ConnectionProfileType;
  profileSnapshot?: ConnectionProfile;
  passwordAttempted: boolean;
  connected: boolean;
  pendingAutoInputRuleIds: string[];
  firedAutoInputRuleIds: string[];
  createdAt: string;
}

interface CurrentConnectionContext {
  terminalSessionId: string;
  profileId: string;
  profileType: ConnectionProfileType;
  displayName: string;
  targetHost?: string;
  targetUser?: string;
  jumpHost?: string;
  jumpUser?: string;
}

interface HiddenConnectionInputEcho {
  remaining: string;
  missedChunks: number;
}

interface ConnectionDisplayFilterResult {
  data: string;
  replaceBuffer: boolean;
}

interface CommandExplanationTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface CommandExplanationState {
  suggestionId: string;
  isOpen: boolean;
  isLoading: boolean;
  followUpQuestion: string;
  turns: CommandExplanationTurn[];
  error?: string;
}

interface ExecuteTerminalCommandOptions {
  suggestion?: CommandSuggestion;
}

interface RunningExecutionState {
  executionId: string;
  terminalSessionId: string;
  command: string;
  wrappedCommand: string;
  markerId: string;
  startMarker: string;
  doneMarker: string;
  outputBuffer: string;
}

type ProbeDebugLogger = (message: string) => void;

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
  aiConversations: AiConversation[] = [];
  activeAiConversation?: AiConversation;
  activeAiConversationId: string = '';
  currentQuestion: string = '';
  isProcessingAI: boolean = false;
  commandExplanationStates: Record<string, CommandExplanationState> = {};
  readonly executionResultFeatureEnabled = false;
  isAIPanelVisible: boolean = true;
  activeAiView: 'chat' | 'settings' = 'chat';
  aiApiBaseUrl: string = 'https://api.openai.com/v1';
  aiApiKey: string = '';
  currentLLMModel: string = '';
  availableModels: string[] = [];
  aiSettingsStatus: string = '';
  aiLogFilePath: string = '';
  isLoadingModels: boolean = false;
  copyToastMessage: string = '';
  isCopyToastVisible: boolean = false;

  // Connection profile properties
  connectionProfiles: ConnectionProfile[] = [];
  connectionFormMode: 'create' | 'edit' = 'create';
  editingConnectionProfileId: string = '';
  connectionStatus: string = '';
  isConnectionManagerOpen: boolean = false;
  isConnectionFormOpen: boolean = false;
  isTerminalLauncherOpen: boolean = false;
  wslDistributions: WslDistribution[] = [];
  isProcessElevated: boolean = false;
  isProcessElevationStatusLoaded: boolean = false;
  processElevationStatusError: string = '';
  isLoadingTerminalProfiles: boolean = false;
  terminalProfilesStatus: string = '';
  isProbingConnectionProfile: boolean = false;
  probeStatus: string = '';
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
  @ViewChild('tabsScrollArea') tabsScrollAreaRef?: ElementRef<HTMLDivElement>;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private ptyListenersRegistered = false;
  private ptySessions = new Set<string>();
  private pendingPtySessions = new Set<string>();
  private ptySessionPromises = new Map<string, Promise<void>>();
  private ptyBufferBySession = new Map<string, string>();
  private ptyRawBufferBySession = new Map<string, string>();
  private ptyDisplayEpochBySession = new Map<string, number>();
  private hiddenConnectionInputEchoesBySession = new Map<string, HiddenConnectionInputEcho[]>();
  private authPromptReplayFilteredSessions = new Set<string>();
  private autoInputReplayValuesBySession = new Map<string, string[]>();
  private postAutoInputNormalizeBudgetBySession = new Map<string, number>();
  private pendingPtyInputBySession = new Map<string, string>();
  private ptyInputFlushPromises = new Map<string, Promise<void>>();
  private runningExecutionStatesBySession = new Map<string, RunningExecutionState>();
  private pendingMacShiftPrintableKeypress: string | null = null;
  private activeConnectionRuntimes = new Map<string, ActiveConnectionRuntime>();
  private aiAbortController: AbortController | null = null;
  private commandExplanationAbortControllers = new Map<string, AbortController>();
  private copyToastTimeoutId?: number;
  private wslDistributionsLoaded = false;
  private wslDistributionsLoadPromise: Promise<void> | null = null;
  private lastWslDistributionsLoadAttemptAt = 0;
  private isRenderingPtyBuffer = false;
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
    private aiChatLogService: AiChatLogService,
    private aiConversationService: AiConversationService,
    private aiResponseFormatService: AiResponseFormatService,
    private connectionProfileService: ConnectionProfileService,
    private openAiConnectionService: OpenAiCompatibleConnectionService,
    private terminalSessionService: TerminalSessionService,
    private connectionCommandService: ConnectionCommandService,
    private connectionProbeLogicService: ConnectionProbeLogicService,
    private commandExecutionFormatService: CommandExecutionFormatService,
    private commandTagParserService: CommandTagParserService,
    private commandRiskPolicyService: CommandRiskPolicyService
  ) { }


  // Public method to sanitize HTML content
  public sanitizeHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  getMessageDisplaySegments(message: AiMessage): string[] {
    return this.splitMessageIntoDisplaySegments(this.getDisplayText(message.content));
  }

  getDisplayText(text: string): string {
    return text
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '  ');
  }

  private splitMessageIntoDisplaySegments(text: string): string[] {
    const segments = text.split(/(<code-block-\d+><\/code-block-\d+>)/g);
    return segments.filter(segment => segment.length > 0);
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
    await this.aiConversationService.loadRecentConversations();
    void this.loadAiLogFilePath();
    this.loadConnectionProfiles();
    void this.refreshProcessElevationStatus();

    // Initialize first terminal session
    const defaultTerminalKind = this.getDefaultTerminalKind();
    this.createNewSession(
      this.getDefaultTerminalName(defaultTerminalKind),
      true,
      undefined,
      defaultTerminalKind
    );

    // Clean any existing code blocks to ensure no backticks are displayed
    this.syncAiConversationState();
    this.sanitizeAllCodeBlocks();
    this.syncAiConversationState();
  }

  private async loadAiLogFilePath(): Promise<void> {
    try {
      this.aiLogFilePath = await this.aiChatLogService.getLogDirectoryPath();
    } catch (error) {
      console.error('Failed to resolve AI chat log file path:', error);
    }
  }

  ngAfterViewInit(): void {
    this.initializeInteractiveTerminal();
    this.resizeInteractiveTerminal();
  }

  private initializeInteractiveTerminal(): void {
    if (!this.terminalContainerRef?.nativeElement) {
      return;
    }

    if (!this.terminal) {
      this.createInteractiveTerminalInstance();
    }

    if (!this.ptyListenersRegistered) {
      this.ptyListenersRegistered = true;
      void this.registerPtyListeners();
    }

    if (this.activeSessionId) {
      void this.ensurePtySession(this.activeSessionId);
    }
  }

  private createInteractiveTerminalInstance(): void {
    const terminalContainer = this.terminalContainerRef?.nativeElement;
    if (!terminalContainer) {
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
    this.terminal.open(terminalContainer);
    this.fitAddon.fit();
    this.registerTerminalClipboardShortcuts();
    this.focusTerminalInput();

    this.terminal.onData((data: string) => {
      if (this.isRenderingPtyBuffer) {
        // Replayed SSH output can contain terminal queries; do not forward xterm's replay responses.
        return;
      }

      this.writeToActivePty(data);
    });

    this.terminal.onResize(({ cols, rows }) => {
      if (!this.activeSessionId) {
        return;
      }
      if (!this.isTerminalSessionWritable(this.activeSessionId)) {
        return;
      }
      invoke<void>('pty_resize', { sessionId: this.activeSessionId, cols, rows })
        .catch((error) => {
          console.error('Failed to resize PTY:', error);
        });
    });
  }

  private registerTerminalClipboardShortcuts(): void {
    if (!this.terminal) {
      return;
    }

    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (this.handleMacShiftPrintableKey(event)) {
        return false;
      }

      if (event.type !== 'keydown' || (!event.ctrlKey && !event.metaKey)) {
        return true;
      }

      const key = event.key.toLowerCase();
      if (key === 'c') {
        event.preventDefault();
        this.copyTerminalSelectionOrInterrupt();
        return false;
      }

      if (key === 'v') {
        event.preventDefault();
        void this.pasteClipboardToTerminal();
        return false;
      }

      return true;
    });
  }

  private handleMacShiftPrintableKey(event: KeyboardEvent): boolean {
    if (event.type === 'keypress' && this.pendingMacShiftPrintableKeypress) {
      if (event.key === this.pendingMacShiftPrintableKeypress) {
        event.preventDefault();
        event.stopPropagation();
        this.pendingMacShiftPrintableKeypress = null;
        return true;
      }
      this.pendingMacShiftPrintableKeypress = null;
    }

    if (
      event.type !== 'keydown' ||
      this.detectOperatingSystem() !== 'macOS' ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      event.key.length !== 1 ||
      !this.isShiftPrintableFallbackKey(event.key)
    ) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    this.pendingMacShiftPrintableKeypress = event.key;
    this.writeToActivePty(event.key);
    return true;
  }

  private isShiftPrintableFallbackKey(key: string): boolean {
    return /^[\x20-\x7E]$/.test(key) && !/^[A-Za-z]$/.test(key);
  }

  private copyTerminalSelectionOrInterrupt(): void {
    if (!this.terminal) {
      return;
    }

    const selection = this.terminal.hasSelection() ? this.terminal.getSelection() : '';
    if (selection) {
      void this.copyToClipboard(selection);
      return;
    }

    this.writeToActivePty('\x03');
  }

  private async pasteClipboardToTerminal(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this.writeToActivePty(text);
      }
    } catch (error) {
      console.error('Failed to paste clipboard text to terminal:', error);
    }
  }

  private writeToActivePty(data: string): void {
    if (!this.activeSessionId || !data || !this.isTerminalSessionWritable(this.activeSessionId)) {
      return;
    }

    void this.writeToPtySession(this.activeSessionId, data);
  }

  private async writeToPtySession(sessionId: string, data: string): Promise<void> {
    if (!data || !this.isTerminalSessionWritable(sessionId)) {
      return;
    }

    this.enqueuePtyInput(sessionId, data);
    await this.flushPendingPtyInput(sessionId);
  }

  private enqueuePtyInput(sessionId: string, data: string): void {
    const pendingInput = this.pendingPtyInputBySession.get(sessionId) || '';
    this.pendingPtyInputBySession.set(sessionId, pendingInput + data);
  }

  private async flushPendingPtyInput(sessionId: string): Promise<void> {
    const existingFlush = this.ptyInputFlushPromises.get(sessionId);
    if (existingFlush) {
      return existingFlush;
    }

    const flushPromise = this.flushPendingPtyInputLoop(sessionId).finally(() => {
      this.ptyInputFlushPromises.delete(sessionId);
    });
    this.ptyInputFlushPromises.set(sessionId, flushPromise);
    return flushPromise;
  }

  private async flushPendingPtyInputLoop(sessionId: string): Promise<void> {
    while (this.pendingPtyInputBySession.has(sessionId)) {
      if (this.isRenderingPtyBuffer && sessionId === this.activeSessionId) {
        await this.waitForNextAnimationFrame();
        continue;
      }

      await this.ensurePtySession(sessionId);
      if (!this.ptySessions.has(sessionId)) {
        return;
      }

      const data = this.pendingPtyInputBySession.get(sessionId) || '';
      this.pendingPtyInputBySession.delete(sessionId);
      if (!data) {
        continue;
      }

      try {
        await invoke<void>('pty_write', { sessionId, data });
      } catch (error) {
        this.pendingPtyInputBySession.set(
          sessionId,
          data + (this.pendingPtyInputBySession.get(sessionId) || '')
        );
        console.error('Failed to write to PTY:', error);
        return;
      }
    }
  }

  private waitForNextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  private async registerPtyListeners(): Promise<void> {
    const unlistenPtyOutput = await listen('pty_output', async (event) => {
      const payload = event.payload as { sessionId: string; data: string };

      this.respondToTerminalStatusQueries(payload.sessionId, payload.data);
      this.captureRunningExecutionOutput(payload.sessionId, payload.data);

      const previousRaw = this.ptyRawBufferBySession.get(payload.sessionId) || '';
      this.ptyRawBufferBySession.set(payload.sessionId, previousRaw + payload.data);
      this.updateConnectionRuntimeFromOutput(payload.sessionId);
      this.logConnectionDisplayDebug('pty_output raw chunk', {
        sessionId: payload.sessionId,
        ...this.describeTerminalDataForDebug(payload.data)
      });

      const displayEpoch = this.ptyDisplayEpochBySession.get(payload.sessionId) || 0;
      const suppressDisplayData = await this.handleConnectionAutomation(payload.sessionId);
      this.logConnectionDisplayDebug('pty_output processed automation', {
        sessionId: payload.sessionId,
        chunkLength: payload.data.length,
        suppressDisplayData,
        displayEpoch,
        currentEpoch: this.ptyDisplayEpochBySession.get(payload.sessionId) || 0
      });
      if (suppressDisplayData) {
        return;
      }
      if ((this.ptyDisplayEpochBySession.get(payload.sessionId) || 0) !== displayEpoch) {
        this.logConnectionDisplayDebug('discarded stale display chunk after truncation', {
          sessionId: payload.sessionId,
          displayEpoch,
          currentEpoch: this.ptyDisplayEpochBySession.get(payload.sessionId) || 0,
          chunkLength: payload.data.length
        });
        return;
      }

      const connectionDisplay = this.filterConnectionDisplayOutput(payload.sessionId, payload.data);
      const displayData = this.filterRunningExecutionDisplayOutput(payload.sessionId, connectionDisplay.data);
      this.logConnectionDisplayDebug('connection display filter result', {
        sessionId: payload.sessionId,
        replaceBuffer: connectionDisplay.replaceBuffer,
        raw: this.describeTerminalDataForDebug(payload.data),
        connectionFiltered: this.describeTerminalDataForDebug(connectionDisplay.data),
        displayFiltered: this.describeTerminalDataForDebug(displayData)
      });
      const existingDisplayBuffer = this.ptyBufferBySession.get(payload.sessionId) || '';
      const previous = connectionDisplay.replaceBuffer ? '' : existingDisplayBuffer;
      const nextDisplayBuffer = previous + displayData;
      const visibleDisplayUnchanged = connectionDisplay.replaceBuffer &&
        this.areTerminalDisplayBuffersVisiblyEqual(existingDisplayBuffer, nextDisplayBuffer);
      const finalDisplayBuffer = visibleDisplayUnchanged ? existingDisplayBuffer : nextDisplayBuffer;
      this.ptyBufferBySession.set(payload.sessionId, finalDisplayBuffer);
      this.logConnectionDisplayDebug(
        connectionDisplay.replaceBuffer ? 'replaced display buffer from replay chunk' : 'appended display chunk',
        {
          sessionId: payload.sessionId,
          displayChunkLength: displayData.length,
          displayBufferLength: finalDisplayBuffer.length,
          replaceBuffer: connectionDisplay.replaceBuffer,
          visibleDisplayUnchanged
        }
      );

      if (visibleDisplayUnchanged) {
        return;
      }

      if (payload.sessionId === this.activeSessionId && this.terminal && displayData) {
        if (connectionDisplay.replaceBuffer) {
          this.recreateInteractiveTerminalForReplay();
        }
        this.terminal.write(displayData);
      }
    });

    const unlistenPtyExit = await listen('pty_exit', (event) => {
      const payload = event.payload as { sessionId: string; success: boolean };
      const rawOutput = this.ptyRawBufferBySession.get(payload.sessionId) || '';
      this.handlePtySessionExit(payload.sessionId, payload.success, rawOutput);
      this.ptySessions.delete(payload.sessionId);
      this.pendingPtySessions.delete(payload.sessionId);
      this.ptySessionPromises.delete(payload.sessionId);
      this.pendingPtyInputBySession.delete(payload.sessionId);
      this.ptyInputFlushPromises.delete(payload.sessionId);
      this.ptyRawBufferBySession.delete(payload.sessionId);
      this.ptyDisplayEpochBySession.delete(payload.sessionId);
      this.hiddenConnectionInputEchoesBySession.delete(payload.sessionId);
      this.authPromptReplayFilteredSessions.delete(payload.sessionId);
      this.autoInputReplayValuesBySession.delete(payload.sessionId);
      this.postAutoInputNormalizeBudgetBySession.delete(payload.sessionId);
      this.failRunningExecutionForSession(payload.sessionId);
    });

    this.unlistenFunctions.push(unlistenPtyOutput, unlistenPtyExit);
  }

  private updateConnectionRuntimeFromOutput(sessionId: string): void {
    const runtime = this.activeConnectionRuntimes.get(sessionId);
    if (!runtime || runtime.connected) {
      return;
    }

    const session = this.terminalSessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return;
    }

    const rawOutput = this.ptyRawBufferBySession.get(sessionId) || '';
    const normalizedOutput = this.connectionProbeLogicService.normalizeTerminalOutput(rawOutput);
    if (!normalizedOutput || this.connectionProbeLogicService.hasProbeConnectionFailure(normalizedOutput)) {
      return;
    }

    if (!this.hasLikelyEstablishedConnectionOutput(sessionId, normalizedOutput)) {
      return;
    }

    const profile = this.getConnectionRuntimeProfile(runtime);
    if (!profile) {
      return;
    }

    runtime.connected = true;
    this.markSessionConnected(sessionId, profile);
    this.connectionProfileService.markConnected(profile.id);
    this.loadConnectionProfiles();
    this.connectionStatus = `Connected ${this.generateConnectionDisplayName(profile)}.`;
  }

  private hasLikelyEstablishedConnectionOutput(sessionId: string, normalizedOutput: string): boolean {
    const outputTail = this.getPtyOutputTail(sessionId);
    if (this.connectionProbeLogicService.hasPasswordPrompt(outputTail)) {
      return false;
    }

    return /(?:Welcome to |Last login:|JumpServer|主机IP|选择组|Documentation:)/i.test(normalizedOutput) ||
      this.connectionProbeLogicService.hasLikelyShellPrompt(normalizedOutput);
  }

  private handlePtySessionExit(sessionId: string, success: boolean, rawOutput: string): void {
    const session = this.terminalSessions.find((candidate) => candidate.id === sessionId);
    if (!session?.connectionProfileId && !session?.launchCommand) {
      return;
    }

    const runtime = this.activeConnectionRuntimes.get(sessionId);
    const cleanOutput = this.connectionProbeLogicService.normalizeTerminalOutput(rawOutput);
    const failureLine = this.connectionProbeLogicService.extractConnectionFailureLine(cleanOutput.slice(-4000));
    const wasConnected = Boolean(runtime?.connected || session?.connectionState === 'connected');
    const nextState: TerminalConnectionState = failureLine
      ? (wasConnected ? 'disconnected' : 'failed')
      : success
        ? 'ended'
        : (wasConnected ? 'disconnected' : 'failed');
    const fallbackReason = success
      ? 'Remote session ended.'
      : wasConnected
        ? 'Remote connection closed unexpectedly.'
        : 'SSH process exited before the connection completed.';

    this.markConnectionSessionTerminated(sessionId, nextState, failureLine || fallbackReason);
  }

  private respondToTerminalStatusQueries(sessionId: string, data: string): void {
    if (sessionId === this.activeSessionId || !data.includes('\x1b[6n') || !this.isTerminalSessionWritable(sessionId)) {
      return;
    }

    void invoke<void>('pty_write', { sessionId, data: '\x1b[1;1R' }).catch((error) => {
      console.error(`Failed to respond to terminal status query for ${sessionId}:`, error);
    });
  }

  private filterRunningExecutionDisplayOutput(sessionId: string, data: string): string {
    const runningExecution = this.runningExecutionStatesBySession.get(sessionId);
    if (!runningExecution) {
      return data;
    }

    let filteredData = data;
    if (runningExecution.wrappedCommand && runningExecution.wrappedCommand !== runningExecution.command) {
      filteredData = filteredData.split(runningExecution.wrappedCommand).join(runningExecution.command);
    }

    if (runningExecution.startMarker && runningExecution.doneMarker) {
      filteredData = filteredData
        .replace(new RegExp(`\\r?\\n?${this.commandExecutionFormatService.escapeRegExp(runningExecution.startMarker)}\\r?\\n?`, 'g'), '\r\n')
        .replace(new RegExp(`\\r?\\n?${this.commandExecutionFormatService.escapeRegExp(runningExecution.doneMarker)}:-?\\d+\\r?\\n?`, 'g'), '\r\n')
        .replace(new RegExp(this.commandExecutionFormatService.escapeRegExp(runningExecution.startMarker), 'g'), '')
        .replace(new RegExp(`${this.commandExecutionFormatService.escapeRegExp(runningExecution.doneMarker)}:-?\\d+`, 'g'), '');
    }

    return filteredData;
  }

  private filterConnectionDisplayOutput(sessionId: string, data: string): ConnectionDisplayFilterResult {
    let filteredData = data;
    let replaceBuffer = false;

    const authReplay = this.filterAuthPromptReplayDisplayOutput(sessionId, filteredData);
    filteredData = authReplay.data;
    replaceBuffer = replaceBuffer || authReplay.replaceBuffer;

    const autoInputReplay = this.filterAutoInputReplayDisplayOutput(sessionId, filteredData);
    filteredData = autoInputReplay.data;
    replaceBuffer = replaceBuffer || autoInputReplay.replaceBuffer;

    filteredData = this.filterConnectionInputEchoDisplayOutput(sessionId, filteredData);
    filteredData = this.normalizePostAutoInputDisplayOutputForSession(sessionId, filteredData);
    return {
      data: filteredData,
      replaceBuffer
    };
  }

  private filterAuthPromptReplayDisplayOutput(sessionId: string, data: string): ConnectionDisplayFilterResult {
    if (!this.authPromptReplayFilteredSessions.has(sessionId) || !data) {
      return { data, replaceBuffer: false };
    }

    const authPromptEnd = this.findLastSshAuthPromptEnd(data);
    if (authPromptEnd < 0) {
      return { data, replaceBuffer: false };
    }

    const existingDisplayBuffer = this.ptyBufferBySession.get(sessionId) || '';
    if (existingDisplayBuffer.length > 0) {
      this.logConnectionDisplayDebug('discarded ssh auth replay output', {
        sessionId,
        originalLength: data.length,
        displayBufferLength: existingDisplayBuffer.length
      });
      return {
        data: '',
        replaceBuffer: false
      };
    }

    const filteredData = this.stripLeadingReplayControls(data.slice(authPromptEnd));
    this.logConnectionDisplayDebug('filtered ssh auth replay output', {
      sessionId,
      originalLength: data.length,
      filteredLength: filteredData.length
    });
    return {
      data: filteredData,
      replaceBuffer: true
    };
  }

  private filterAutoInputReplayDisplayOutput(sessionId: string, data: string): ConnectionDisplayFilterResult {
    const replayValues = this.autoInputReplayValuesBySession.get(sessionId) || [];
    if (!replayValues.length || !data) {
      return { data, replaceBuffer: false };
    }

    let filteredData = data;
    let replaceBuffer = false;
    for (const replayValue of replayValues) {
      const trimIndex = this.findJumpServerAutoInputReplayTrimIndex(filteredData, replayValue);
      if (trimIndex < 0) {
        continue;
      }

      const existingDisplayBuffer = this.ptyBufferBySession.get(sessionId) || '';
      if (existingDisplayBuffer.length > 0) {
        this.logConnectionDisplayDebug('discarded jumpserver auto input replay output', {
          sessionId,
          originalLength: data.length,
          displayBufferLength: existingDisplayBuffer.length
        });
        return {
          data: '',
          replaceBuffer: false
        };
      }

      filteredData = this.stripLeadingReplayControls(filteredData.slice(trimIndex));
      replaceBuffer = true;
    }

    if (replaceBuffer) {
      this.logConnectionDisplayDebug('filtered jumpserver auto input replay output', {
        sessionId,
        originalLength: data.length,
        filteredLength: filteredData.length
      });
    }
    return {
      data: filteredData,
      replaceBuffer
    };
  }

  private findLastSshAuthPromptEnd(data: string): number {
    const patterns = [
      /Enter passphrase for key[^\r\n]*[:：]/ig,
      /[^\r\n]*'s password[:：]/ig
    ];
    let promptEnd = -1;

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(data)) !== null) {
        promptEnd = Math.max(promptEnd, match.index + match[0].length);
      }
    }

    if (promptEnd < 0) {
      return -1;
    }

    return promptEnd;
  }

  private findJumpServerAutoInputReplayTrimIndex(data: string, input: string): number {
    if (!input) {
      return -1;
    }

    const inputIndex = data.lastIndexOf(input);
    if (inputIndex < 0) {
      return -1;
    }

    const prefix = data.slice(0, inputIndex);
    const suffix = data.slice(inputIndex + input.length);
    if (
      !/(?:JumpServer|group_id|group\s*:|host_num|选择组|主机IP)/i.test(prefix) ||
      !/(?:Connecting|Welcome|Last login)/i.test(suffix)
    ) {
      return -1;
    }

    return inputIndex + input.length;
  }

  private stripLeadingReplayControls(value: string): string {
    let index = 0;
    let prefix = '';

    while (index < value.length) {
      const rest = value.slice(index);
      const controlMatch = rest.match(/^(?:\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)|\x1B[()][A-Za-z0-9]|\x1B.|[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F]+)/);
      if (controlMatch) {
        index += controlMatch[0].length;
        continue;
      }

      if (rest.startsWith('\r\n')) {
        prefix += '\r\n';
        index += 2;
        continue;
      }

      if (rest[0] === '\r' || rest[0] === '\n') {
        prefix += rest[0];
        index += 1;
        continue;
      }

      break;
    }

    return prefix + value.slice(index);
  }

  private areTerminalDisplayBuffersVisiblyEqual(left: string, right: string): boolean {
    return this.toComparableTerminalText(left) === this.toComparableTerminalText(right);
  }

  private toComparableTerminalText(value: string): string {
    return value
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B[()][A-Za-z0-9]/g, '')
      .replace(/\x1B./g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+$/gm, '');
  }

  private filterConnectionInputEchoDisplayOutput(sessionId: string, data: string): string {
    const hiddenEchoes = this.hiddenConnectionInputEchoesBySession.get(sessionId);
    if (!hiddenEchoes?.length || !data) {
      return data;
    }

    this.logConnectionDisplayDebug('filtering hidden connection input echo', {
      sessionId,
      hiddenEchoCount: hiddenEchoes.length,
      data: this.describeTerminalDataForDebug(data)
    });
    let filteredData = data;
    while (hiddenEchoes.length > 0 && filteredData.length > 0) {
      const hiddenEcho = hiddenEchoes[0];
      const expectedEcho = hiddenEcho.remaining;
      if (!expectedEcho) {
        hiddenEchoes.shift();
        continue;
      }

      const echoIndex = filteredData.indexOf(expectedEcho);
      if (echoIndex >= 0) {
        const beforeNormalize = filteredData.slice(echoIndex + expectedEcho.length);
        hiddenEchoes.shift();
        filteredData = this.normalizePostAutoInputDisplayOutput(
          this.stripLeadingReplayControls(beforeNormalize)
        );
        this.logConnectionDisplayDebug('matched hidden connection input echo', {
          sessionId,
          echoIndex,
          inputLength: expectedEcho.length,
          beforeNormalize: this.describeTerminalDataForDebug(beforeNormalize),
          afterNormalize: this.describeTerminalDataForDebug(filteredData)
        });
        continue;
      }

      if (expectedEcho.startsWith(filteredData)) {
        hiddenEcho.remaining = expectedEcho.slice(filteredData.length);
        hiddenEcho.missedChunks = 0;
        filteredData = '';
        this.logConnectionDisplayDebug('hidden connection input echo spans chunks', {
          sessionId,
          remainingLength: hiddenEcho.remaining.length
        });
        break;
      }

      this.logConnectionDisplayDebug('hidden connection input echo not found in chunk', {
        sessionId,
        expectedEchoLength: expectedEcho.length,
        data: this.describeTerminalDataForDebug(filteredData)
      });
      hiddenEchoes.shift();
      break;
    }

    if (hiddenEchoes.length === 0) {
      this.hiddenConnectionInputEchoesBySession.delete(sessionId);
    }
    return filteredData;
  }

  private normalizePostAutoInputDisplayOutput(data: string): string {
    const normalized = data
      .replace(/\x1B\[\?25[hl]/g, '')
      .replace(/\x1B\[(\d+);1H/g, '\r\n')
      .replace(/\x1B\[\d+;\d+H/g, '')
      .replace(/\x1B\[\d+G/g, '')
      .replace(/(?:(?:\r\n|\r|\n)[ \t]*){3,}/g, '\r\n\r\n')
      .replace(/^(?:\r\n|\r|\n)+$/g, '');
    if (normalized !== data) {
      this.logConnectionDisplayDebug('normalized post auto input blank lines', {
        before: this.describeTerminalDataForDebug(data),
        after: this.describeTerminalDataForDebug(normalized)
      });
    }
    return normalized;
  }

  private normalizePostAutoInputDisplayOutputForSession(sessionId: string, data: string): string {
    const budget = this.postAutoInputNormalizeBudgetBySession.get(sessionId) || 0;
    if (budget <= 0 || !data) {
      return data;
    }

    const normalized = this.normalizePostAutoInputDisplayOutput(data);
    const nextBudget = this.hasLikelyShellPrompt(normalized) ? 0 : budget - 1;
    if (nextBudget <= 0) {
      this.postAutoInputNormalizeBudgetBySession.delete(sessionId);
    } else {
      this.postAutoInputNormalizeBudgetBySession.set(sessionId, nextBudget);
    }

    return normalized;
  }

  private hasLikelyShellPrompt(data: string): boolean {
    return /(?:^|\r?\n).+[@][^:\r\n]+:.*[$#]\s*$/.test(
      this.connectionProbeLogicService.normalizeTerminalOutput(data)
    );
  }

  private captureRunningExecutionOutput(sessionId: string, data: string): void {
    const runningExecution = this.runningExecutionStatesBySession.get(sessionId);
    if (!runningExecution) {
      return;
    }

    runningExecution.outputBuffer += data;
    const doneMarkerIndex = runningExecution.outputBuffer.indexOf(runningExecution.doneMarker);
    const hasMarkerCompletion = doneMarkerIndex !== -1;
    const hasPromptCompletion = !hasMarkerCompletion && this.commandExecutionFormatService.isPromptCompletionDetected(
      runningExecution.outputBuffer,
      runningExecution.command
    );
    if (!hasMarkerCompletion && !hasPromptCompletion) {
      return;
    }

    const rawOutput = hasMarkerCompletion
      ? this.commandExecutionFormatService.extractRawOutputBetweenMarkers(
          runningExecution.outputBuffer.slice(0, doneMarkerIndex),
          runningExecution
        )
      : this.commandExecutionFormatService.extractRawOutputFromPromptCompletion(runningExecution);
    const exitCode = hasMarkerCompletion
      ? this.commandExecutionFormatService.parseExecutionExitCode(
          runningExecution.outputBuffer.slice(doneMarkerIndex + runningExecution.doneMarker.length)
        )
      : undefined;

    this.aiConversationService.completeCommandExecution(
      runningExecution.executionId,
      rawOutput,
      exitCode
    );
    this.runningExecutionStatesBySession.delete(sessionId);
    this.syncAiConversationState();
    this.shouldScroll = true;
  }

  private failRunningExecutionForSession(sessionId: string): void {
    const runningExecution = this.runningExecutionStatesBySession.get(sessionId);
    if (!runningExecution) {
      return;
    }

    const rawOutput = this.commandExecutionFormatService.extractRawOutputBetweenMarkers(
      runningExecution.outputBuffer,
      runningExecution
    );
    this.aiConversationService.markCommandExecutionFailed(runningExecution.executionId, {
      rawOutput,
      outputPreview: rawOutput.trim() ? rawOutput.trim().slice(0, 700) : '(session closed before command completed)',
      includedInContext: Boolean(rawOutput.trim()),
      contextMode: rawOutput.trim() ? 'full' : 'none'
    });
    this.runningExecutionStatesBySession.delete(sessionId);
    this.syncAiConversationState();
  }

  private async ensurePtySession(sessionId: string): Promise<void> {
    if (!this.terminal || this.ptySessions.has(sessionId)) {
      return;
    }

    const session = this.terminalSessions.find((candidate) => candidate.id === sessionId);
    if (this.isTerminalSessionTerminated(session)) {
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
      await invoke<void>('pty_create_session', {
        sessionId,
        cols,
        rows,
        launchKind: session?.terminalKind,
        wslDistroName: session?.wslDistroName,
        launchCommand: session?.launchCommand
      });
      this.ptySessions.add(sessionId);
      if (!this.ptyBufferBySession.has(sessionId)) {
        this.ptyBufferBySession.set(sessionId, '');
      }
      if (!this.ptyRawBufferBySession.has(sessionId)) {
        this.ptyRawBufferBySession.set(sessionId, '');
      }
      if (!this.ptyDisplayEpochBySession.has(sessionId)) {
        this.ptyDisplayEpochBySession.set(sessionId, 0);
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
    if (!this.activeSessionId) {
      return;
    }

    const sessionId = this.activeSessionId;
    const sessionBuffer = this.ptyBufferBySession.get(sessionId) || '';
    this.isRenderingPtyBuffer = true;
    this.logConnectionDisplayDebug('rendering active display buffer', {
      sessionId,
      displayBufferLength: sessionBuffer.length,
      rawBufferLength: (this.ptyRawBufferBySession.get(sessionId) || '').length,
      displayEpoch: this.ptyDisplayEpochBySession.get(sessionId) || 0
    });
    this.recreateInteractiveTerminalForReplay();
    this.updateTerminalInputMode();
    if (!this.terminal) {
      this.isRenderingPtyBuffer = false;
      return;
    }
    if (sessionBuffer.length > 0) {
      this.terminal.write(sessionBuffer, () => {
        this.isRenderingPtyBuffer = false;
        void this.flushPendingPtyInput(sessionId);
      });
      return;
    }

    queueMicrotask(() => {
      this.isRenderingPtyBuffer = false;
      void this.flushPendingPtyInput(sessionId);
    });
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
    if (!this.isTerminalSessionWritable(this.activeSessionId)) {
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
    this.pendingPtyInputBySession.clear();
    this.ptyInputFlushPromises.clear();
    this.ptyRawBufferBySession.clear();
    this.ptyDisplayEpochBySession.clear();
    this.hiddenConnectionInputEchoesBySession.clear();
    this.authPromptReplayFilteredSessions.clear();
    this.autoInputReplayValuesBySession.clear();
    this.postAutoInputNormalizeBudgetBySession.clear();
    this.runningExecutionStatesBySession.clear();
    this.activeConnectionRuntimes.clear();
    if (this.copyToastTimeoutId !== undefined) {
      window.clearTimeout(this.copyToastTimeoutId);
      this.copyToastTimeoutId = undefined;
    }
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

  private ensureAiConversationForCurrentSession(): AiConversation {
    const sessionId = this.activeSessionId || 'unassigned-terminal-session';
    const conversation = this.aiConversationService.ensureConversationForTerminalSession(sessionId);
    this.syncAiConversationState();
    return conversation;
  }

  private getConversationForNextQuestion(): { conversation: AiConversation; isNewConversation: boolean } {
    const activeConversation = this.aiConversationService.getActiveConversation();
    if (activeConversation) {
      return { conversation: activeConversation, isNewConversation: false };
    }

    const conversation = this.aiConversationService.createConversation(
      this.activeSessionId || 'unassigned-terminal-session'
    );
    return { conversation, isNewConversation: true };
  }

  private syncAiConversationState(): void {
    this.aiConversations = this.aiConversationService.listConversations();
    this.activeAiConversationId = this.aiConversationService.getActiveConversationId();
    this.activeAiConversation = this.aiConversationService.getActiveConversation();
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
    return this.commandTagParserService.parseCommandTags(response).map((commandTag) => ({
      command: commandTag.command,
      fullText: commandTag.raw
    }));
  }

  // Extract code blocks from response text
  extractCodeBlocks(text: string): { formattedText: string, codeBlocks: { code: string, language: string }[] } {
    const parsed = this.commandTagParserService.formatContentWithCommandTags(text);
    return {
      formattedText: parsed.formattedText,
      codeBlocks: parsed.commands.map((commandTag) => ({
        code: commandTag.command,
        language: 'command'
      }))
    };
  }

  // Handle code copy button click
  copyCodeBlock(code: string): void {
    this.copyToClipboard(code);

    // Show a brief "Copied!" notification
    this.showCopiedNotification();
  }

  copyCommandSuggestion(suggestion: CommandSuggestion): void {
    this.copyCodeBlock(suggestion.command);
  }

  getCommandExplanationState(suggestion: CommandSuggestion): CommandExplanationState | undefined {
    return this.commandExplanationStates[suggestion.id];
  }

  async toggleCommandExplanation(suggestion: CommandSuggestion): Promise<void> {
    const existingState = this.commandExplanationStates[suggestion.id];
    if (existingState?.isOpen) {
      this.setCommandExplanationState(suggestion.id, { isOpen: false });
      return;
    }

    const nextState = existingState || this.createEmptyCommandExplanationState(suggestion.id);
    this.commandExplanationStates = {
      ...this.commandExplanationStates,
      [suggestion.id]: {
        ...nextState,
        isOpen: true
      }
    };

    if (!nextState.turns.length && !nextState.isLoading) {
      await this.requestCommandExplanation(suggestion);
    }
  }

  updateCommandExplanationFollowUp(suggestionId: string, value: string): void {
    this.setCommandExplanationState(suggestionId, { followUpQuestion: value });
  }

  async onCommandExplanationFollowUpKeydown(
    event: KeyboardEvent,
    suggestion: CommandSuggestion
  ): Promise<void> {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await this.submitCommandExplanationFollowUp(suggestion);
  }

  async submitCommandExplanationFollowUp(suggestion: CommandSuggestion): Promise<void> {
    const state = this.commandExplanationStates[suggestion.id];
    const question = state?.followUpQuestion.trim();
    if (!state || !question || state.isLoading) {
      return;
    }

    const userTurn: CommandExplanationTurn = {
      role: 'user',
      content: question,
      createdAt: new Date().toISOString()
    };

    this.commandExplanationStates = {
      ...this.commandExplanationStates,
      [suggestion.id]: {
        ...state,
        followUpQuestion: '',
        turns: [...state.turns, userTurn]
      }
    };

    await this.requestCommandExplanation(suggestion);
  }

  // Add visual feedback when copying
  showCopiedNotification(message: string = 'Copied!'): void {
    this.copyToastMessage = message;
    this.isCopyToastVisible = true;

    if (this.copyToastTimeoutId !== undefined) {
      window.clearTimeout(this.copyToastTimeoutId);
    }

    this.copyToastTimeoutId = window.setTimeout(() => {
      this.isCopyToastVisible = false;
      this.copyToastTimeoutId = undefined;
    }, 1500);
  }

  // Check if a code block is a simple command (no special formatting needed)
  isSimpleCommand(code: string): boolean {
    return this.aiResponseFormatService.isSimpleCommand(code);
  }

  // Calls an OpenAI-compatible Chat Completions endpoint with terminal context.
  async callOpenAiCompatibleApi(
    question: string,
    model: string,
    conversationId: string,
    currentUserMessageId: string,
    signal?: AbortSignal
  ): Promise<string> {
    const requestId = this.aiChatLogService.createRequestId('chat');
    let apiEndpoint = '';
    try {
      if (!this.aiApiKey.trim()) {
        await this.aiChatLogService.logEvent({
          requestId,
          phase: 'error',
          operation: 'chat-completion',
          timestamp: new Date().toISOString(),
          model,
          conversationId,
          messageId: currentUserMessageId,
          data: {
            input: question,
            error: 'OpenAI compatible API key is not configured.'
          }
        });
        return 'Error: OpenAI compatible API key is not configured. Open Settings and add a key.';
      }

      if (!model.trim()) {
        await this.aiChatLogService.logEvent({
          requestId,
          phase: 'error',
          operation: 'chat-completion',
          timestamp: new Date().toISOString(),
          conversationId,
          messageId: currentUserMessageId,
          data: {
            input: question,
            error: 'No model is selected.'
          }
        });
        return 'Error: No model is selected. Open Settings, enter a model, or load models from your endpoint.';
      }

      // Get the current operating system
      const os = this.detectOperatingSystem();
      const environmentContext = this.getTerminalAssistantEnvironmentContext();

      const systemPrompt = buildTerminalAssistantSystemPrompt(os, environmentContext);

      // Build messages array with conversation context.
      const messages: { role: string; content: string }[] = [
        { role: 'system', content: systemPrompt }
      ];

      const conversation = this.aiConversationService.getConversation(conversationId);
      const conversationMessages = conversation?.messages || [];
      const currentUserContent = await this.buildCurrentUserContent(question, conversationId);

      for (const message of conversationMessages) {
        if (message.role === 'assistant' && message.content === 'Thinking...') {
          continue;
        }

        messages.push({
          role: message.role,
          content: message.id === currentUserMessageId
            ? currentUserContent
            : this.serializeAiMessageContentForApi(message)
        });
      }

      const requestBody = {
        model: model,
        messages,
        stream: false
      };

      const normalizedBaseUrl = this.openAiConnectionService.normalizeBaseUrl(this.aiApiBaseUrl);
      apiEndpoint = `${normalizedBaseUrl}/chat/completions`;
      const requestHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.aiApiKey.trim()}`
      };

      await this.aiChatLogService.logEvent({
        requestId,
        phase: 'request',
        operation: 'chat-completion',
        timestamp: new Date().toISOString(),
        endpoint: apiEndpoint,
        model,
        conversationId,
        messageId: currentUserMessageId,
        data: {
          method: 'POST',
          headers: this.aiChatLogService.redactHeaders(requestHeaders),
          body: requestBody
        }
      });

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
        signal
      });

      const responseText = await response.text();
      const { parsedResponse, parseError } = this.parseJsonResponseForLog(responseText);

      await this.aiChatLogService.logEvent({
        requestId,
        phase: response.ok && !parseError ? 'response' : 'error',
        operation: 'chat-completion',
        timestamp: new Date().toISOString(),
        endpoint: apiEndpoint,
        model,
        conversationId,
        messageId: currentUserMessageId,
        data: {
          status: response.status,
          statusText: response.statusText,
          rawResponseText: responseText,
          parsedResponse,
          parseError: parseError ? this.aiChatLogService.serializeError(parseError) : undefined
        }
      });

      if (!response.ok) {
        throw new Error(`OpenAI compatible API error: ${response.status} - ${responseText}`);
      }

      if (parseError) {
        return 'Error: Unexpected response format from OpenAI compatible API. See AI chat log for raw response.';
      }

      const data = parsedResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.error('Unexpected response format:', data);
        await this.aiChatLogService.logEvent({
          requestId,
          phase: 'error',
          operation: 'chat-completion',
          timestamp: new Date().toISOString(),
          endpoint: apiEndpoint,
          model,
          conversationId,
          messageId: currentUserMessageId,
          data: {
            reason: 'Missing choices[0].message.content',
            rawResponseText: responseText,
            parsedResponse
          }
        });
        return 'Error: Unexpected response format from OpenAI compatible API. See AI chat log for raw response.';
      }

      return content;
    } catch (error: any) {
      if (this.isAbortError(error)) {
        await this.aiChatLogService.logEvent({
          requestId,
          phase: 'error',
          operation: 'chat-completion',
          timestamp: new Date().toISOString(),
          endpoint: apiEndpoint || undefined,
          model,
          conversationId,
          messageId: currentUserMessageId,
          data: {
            aborted: true,
            error: this.aiChatLogService.serializeError(error)
          }
        });
        throw error;
      }

      await this.aiChatLogService.logEvent({
        requestId,
        phase: 'error',
        operation: 'chat-completion',
        timestamp: new Date().toISOString(),
        endpoint: apiEndpoint || undefined,
        model,
        conversationId,
        messageId: currentUserMessageId,
        data: {
          error: this.aiChatLogService.serializeError(error)
        }
      });

      // Add more specific error messages for different failure types
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return `Error: Could not connect to OpenAI compatible API at ${this.aiApiBaseUrl}. Check the endpoint and network connection.`;
      }

      return `Error: ${error.message || 'Unknown error calling OpenAI compatible API'}`;
    }
  }

  private parseJsonResponseForLog(responseText: string): { parsedResponse: any; parseError?: Error } {
    if (!responseText.trim()) {
      return { parsedResponse: null };
    }

    try {
      return { parsedResponse: JSON.parse(responseText) };
    } catch (error) {
      return {
        parsedResponse: null,
        parseError: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  private isAbortError(error: any): boolean {
    return error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('abort');
  }

  private async buildCurrentUserContent(question: string, conversationId: string): Promise<string> {
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
        // Keep currentWorkingDirectory fallback.
      }
    }

    const contextParts: string[] = [];
    contextParts.push(`Current folder: ${currentFolder}`);
    const environmentContext = this.getTerminalAssistantEnvironmentContext();
    if (environmentContext?.connectionType || environmentContext?.terminalKind === 'local-wsl') {
      contextParts.push([
        `Active terminal target: ${environmentContext.connectionType || 'WSL'}`,
        environmentContext.profileName ? `Profile: ${environmentContext.profileName}` : '',
        environmentContext.targetHost ? `Target host: ${environmentContext.targetHost}` : '',
        environmentContext.targetUser ? `Target user: ${environmentContext.targetUser}` : '',
        environmentContext.wslDistroName ? `WSL distro: ${environmentContext.wslDistroName}` : '',
        environmentContext.serverContext ? `Server context:\n${environmentContext.serverContext}` : ''
      ].filter(Boolean).join('\n'));
    }
    const lastCommands = this.commandHistory
      .filter(c => c.command?.trim())
      .slice(-4)
      .map(c => c.command.trim());
    if (lastCommands.length > 0) {
      contextParts.push(`Recent terminal commands (last ${lastCommands.length}):\n${lastCommands.map(c => `  $ ${c}`).join('\n')}`);
    }
    const executionContext = this.aiConversationService.buildExecutionContextText(
      this.aiConversationService.getConversation(conversationId)
    );
    if (executionContext) {
      contextParts.push(executionContext);
    }
    contextParts.push(`Current question: ${question}`);

    return contextParts.join('\n\n');
  }

  private async requestCommandExplanation(suggestion: CommandSuggestion): Promise<void> {
    if (!this.aiApiKey.trim()) {
      this.setCommandExplanationState(suggestion.id, {
        error: 'OpenAI compatible API key is not configured.',
        isLoading: false
      });
      return;
    }

    if (!this.currentLLMModel.trim()) {
      this.setCommandExplanationState(suggestion.id, {
        error: 'No model is selected.',
        isLoading: false
      });
      return;
    }

    const controller = new AbortController();
    this.commandExplanationAbortControllers.set(suggestion.id, controller);
    this.setCommandExplanationState(suggestion.id, {
      error: undefined,
      isLoading: true
    });

    try {
      const response = await this.callCommandExplanationApi(suggestion, controller.signal);
      const assistantTurn: CommandExplanationTurn = {
        role: 'assistant',
        content: response,
        createdAt: new Date().toISOString()
      };
      const state = this.commandExplanationStates[suggestion.id] || this.createEmptyCommandExplanationState(suggestion.id);
      this.commandExplanationStates = {
        ...this.commandExplanationStates,
        [suggestion.id]: {
          ...state,
          isOpen: true,
          isLoading: false,
          turns: [...state.turns, assistantTurn]
        }
      };
    } catch (error: any) {
      const errorText = this.isAbortError(error)
        ? 'Command explanation stopped.'
        : `Could not explain command: ${error.message || error}`;
      this.setCommandExplanationState(suggestion.id, {
        error: errorText,
        isLoading: false
      });
    } finally {
      this.commandExplanationAbortControllers.delete(suggestion.id);
    }
  }

  private async callCommandExplanationApi(
    suggestion: CommandSuggestion,
    signal: AbortSignal
  ): Promise<string> {
    const requestId = this.aiChatLogService.createRequestId('command-explanation');
    const state = this.commandExplanationStates[suggestion.id] || this.createEmptyCommandExplanationState(suggestion.id);
    const systemPrompt = [
      'You explain terminal commands for production troubleshooting.',
      'Answer in Chinese.',
      'Be concrete and safety-oriented.',
      'Explain what the command does, why it may be useful, key risks, and safer alternatives when relevant.',
      'Do not execute commands.'
    ].join('\n');
    const environmentContext = this.getTerminalAssistantEnvironmentContext();

    const messages: { role: string; content: string }[] = [
      {
        role: 'system',
        content: [
          systemPrompt,
          environmentContext?.serverContext
            ? `Active terminal server context:\n${environmentContext.serverContext}`
            : ''
        ].filter(Boolean).join('\n\n')
      },
      {
        role: 'user',
        content: [
          'Explain this command suggestion.',
          `Command: ${suggestion.command}`,
          `Risk level: ${suggestion.riskLevel}`,
          suggestion.explanation ? `Existing short explanation: ${suggestion.explanation}` : ''
        ].filter(Boolean).join('\n')
      }
    ];

    for (const turn of state.turns) {
      messages.push({
        role: turn.role,
        content: turn.content
      });
    }

    const normalizedBaseUrl = this.openAiConnectionService.normalizeBaseUrl(this.aiApiBaseUrl);
    const apiEndpoint = `${normalizedBaseUrl}/chat/completions`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.aiApiKey.trim()}`
    };
    const requestBody = {
      model: this.currentLLMModel,
      messages,
      stream: false
    };

    await this.aiChatLogService.logEvent({
      requestId,
      phase: 'request',
      operation: 'command-explanation',
      timestamp: new Date().toISOString(),
      endpoint: apiEndpoint,
      model: this.currentLLMModel,
      conversationId: suggestion.conversationId,
      messageId: suggestion.messageId,
      data: {
        suggestionId: suggestion.id,
        method: 'POST',
        headers: this.aiChatLogService.redactHeaders(requestHeaders),
        body: requestBody
      }
    });

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
        signal
      });

      const responseText = await response.text();
      const { parsedResponse, parseError } = this.parseJsonResponseForLog(responseText);

      await this.aiChatLogService.logEvent({
        requestId,
        phase: response.ok && !parseError ? 'response' : 'error',
        operation: 'command-explanation',
        timestamp: new Date().toISOString(),
        endpoint: apiEndpoint,
        model: this.currentLLMModel,
        conversationId: suggestion.conversationId,
        messageId: suggestion.messageId,
        data: {
          suggestionId: suggestion.id,
          status: response.status,
          statusText: response.statusText,
          rawResponseText: responseText,
          parsedResponse,
          parseError: parseError ? this.aiChatLogService.serializeError(parseError) : undefined
        }
      });

      if (!response.ok) {
        throw new Error(`OpenAI compatible API error: ${response.status} - ${responseText}`);
      }

      if (parseError) {
        throw new Error('Unexpected response format from OpenAI compatible API. See AI chat log for raw response.');
      }

      const data = parsedResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        await this.aiChatLogService.logEvent({
          requestId,
          phase: 'error',
          operation: 'command-explanation',
          timestamp: new Date().toISOString(),
          endpoint: apiEndpoint,
          model: this.currentLLMModel,
          conversationId: suggestion.conversationId,
          messageId: suggestion.messageId,
          data: {
            suggestionId: suggestion.id,
            reason: 'Missing choices[0].message.content',
            rawResponseText: responseText,
            parsedResponse
          }
        });
        throw new Error('Unexpected response format from OpenAI compatible API. See AI chat log for raw response.');
      }

      return content;
    } catch (error) {
      await this.aiChatLogService.logEvent({
        requestId,
        phase: 'error',
        operation: 'command-explanation',
        timestamp: new Date().toISOString(),
        endpoint: apiEndpoint,
        model: this.currentLLMModel,
        conversationId: suggestion.conversationId,
        messageId: suggestion.messageId,
        data: {
          suggestionId: suggestion.id,
          aborted: this.isAbortError(error),
          error: this.aiChatLogService.serializeError(error)
        }
      });
      throw error;
    }
  }

  private createEmptyCommandExplanationState(suggestionId: string): CommandExplanationState {
    return {
      suggestionId,
      isOpen: false,
      isLoading: false,
      followUpQuestion: '',
      turns: []
    };
  }

  private setCommandExplanationState(
    suggestionId: string,
    patch: Partial<CommandExplanationState>
  ): void {
    const state = this.commandExplanationStates[suggestionId] || this.createEmptyCommandExplanationState(suggestionId);
    this.commandExplanationStates = {
      ...this.commandExplanationStates,
      [suggestionId]: {
        ...state,
        ...patch
      }
    };
  }

  private serializeAiMessageContentForApi(message: AiMessage): string {
    if (message.rawContent) {
      return message.rawContent;
    }

    if (
      (!message.codeBlocks || message.codeBlocks.length === 0) &&
      (!message.suggestions || message.suggestions.length === 0)
    ) {
      return message.content;
    }

    return message.content.replace(/<code-block-(\d+)><\/code-block-\d+>/g, (_placeholder, indexText: string) => {
      const index = Number(indexText);
      const suggestion = message.suggestions?.[index];
      const codeBlock = message.codeBlocks?.[index];
      const command = suggestion?.command || codeBlock?.code;
      if (!command) {
        return '';
      }

      const title = this.escapeCommandTagAttribute(suggestion?.title || '命令');
      const risk = suggestion?.riskLevel || 'caution';
      return `<CMD title="${title}" risk="${risk}">${command}</CMD>`;
    });
  }

  private escapeCommandTagAttribute(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
    await this.submitCurrentQuestion();
  }

  async onAiRunButtonClick(): Promise<void> {
    if (this.isProcessingAI) {
      this.stopAIResponse();
      return;
    }

    await this.submitCurrentQuestion();
  }

  stopAIResponse(): void {
    this.aiAbortController?.abort();
  }

  private async submitCurrentQuestion(): Promise<void> {
    // Skip if no question or currently processing
    if (!this.currentQuestion.trim() || this.isProcessingAI) {
      return;
    }

    // Handle commands (starting with /)
    const isCommand = this.currentQuestion.startsWith('/');
    let response = '';

    this.isProcessingAI = true;
    this.aiAbortController = new AbortController();
    let shouldClearActiveConversationAfterRequest = false;
    let requestConversationId = '';

    try {
      const { conversation, isNewConversation } = this.getConversationForNextQuestion();
      shouldClearActiveConversationAfterRequest = isNewConversation;
      requestConversationId = conversation.id;
      const question = this.currentQuestion;
      const userMessage = this.aiConversationService.addMessage(conversation.id, {
        role: 'user',
        content: question,
        isCommand
      });
      const assistantMessage = this.aiConversationService.addMessage(conversation.id, {
        role: 'assistant',
        content: 'Thinking...',
        isCommand
      });

      this.syncAiConversationState();
      this.currentQuestion = '';
      this.shouldScroll = true;

      if (isCommand) {
        response = await this.handleAICommand(question);
      } else {
        response = await this.callOpenAiCompatibleApi(
          question,
          this.currentLLMModel,
          conversation.id,
          userMessage.id,
          this.aiAbortController.signal
        );
      }

      this.processAssistantMessage(conversation.id, assistantMessage.id, response, assistantMessage.isCommand);

      // Clear current question and scroll to bottom
      if (shouldClearActiveConversationAfterRequest) {
        this.aiConversationService.clearActiveConversation();
        this.syncAiConversationState();
      }
      this.shouldScroll = true;
    } catch (error) {
      if (this.isAbortError(error)) {
        this.updateLatestAssistantMessage('AI response stopped.');
      } else {
        console.error('Failed to process AI request:', error);
        this.updateLatestAssistantMessage(`Error: ${error}`);
      }
    } finally {
      if (
        shouldClearActiveConversationAfterRequest &&
        requestConversationId &&
        this.aiConversationService.getActiveConversationId() === requestConversationId
      ) {
        this.aiConversationService.clearActiveConversation();
        this.syncAiConversationState();
      }
      this.isProcessingAI = false;
      this.aiAbortController = null;
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

  getMessageCodeBlock(message: AiMessage, placeholder: string): AiCodeBlock | undefined {
    const index = this.getCodeBlockIndex(placeholder);
    if (index < 0) {
      return undefined;
    }

    return message.codeBlocks?.[index];
  }

  getMessageSuggestion(message: AiMessage, placeholder: string): CommandSuggestion | undefined {
    const index = this.getCodeBlockIndex(placeholder);
    if (index < 0) {
      return undefined;
    }

    return message.suggestions?.[index];
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
        this.aiConversationService.clearActiveConversationMessages();
        this.syncAiConversationState();
      },
      getAiLogFilePath: async () => {
        this.aiLogFilePath = await this.aiChatLogService.getLogDirectoryPath();
        return this.aiLogFilePath;
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
    for (const conversation of this.aiConversations) {
      for (const message of conversation.messages) {
        if (!message.codeBlocks || message.codeBlocks.length === 0) {
          continue;
        }

        message.codeBlocks = message.codeBlocks.map((codeBlock) => ({
          ...codeBlock,
          code: this.transformCodeForDisplay(codeBlock.code)
        }));
      }
    }
  }

  processAssistantMessage(
    conversationId: string,
    messageId: string,
    response: string,
    isCommand: boolean = false
  ): void {
    const { formattedText, commands } = this.commandTagParserService.formatContentWithCommandTags(response);
    const createdAt = new Date().toISOString();
    const suggestions = commands.map((commandTag, index) =>
      this.createCommandSuggestion(conversationId, messageId, commandTag, index, createdAt)
    );
    const sanitizedCodeBlocks = suggestions.map((suggestion) => ({
      code: suggestion.command,
      language: 'command'
    }));

    this.aiConversationService.updateMessage(conversationId, messageId, {
      content: formattedText,
      rawContent: response,
      codeBlocks: sanitizedCodeBlocks,
      suggestions,
      isCommand: isCommand || suggestions.length > 0
    });
    this.syncAiConversationState();
  }

  private createCommandSuggestion(
    conversationId: string,
    messageId: string,
    commandTag: ParsedCommandTag,
    index: number,
    createdAt: string
  ): CommandSuggestion {
    return {
      id: `${messageId}-suggestion-${index}`,
      conversationId,
      messageId,
      title: commandTag.title,
      command: commandTag.command,
      riskLevel: commandTag.risk,
      raw: commandTag.raw,
      createdAt
    };
  }

  private updateLatestAssistantMessage(content: string): void {
    const conversation = this.aiConversationService.getActiveConversation();
    const latestAssistantMessage = [...(conversation?.messages || [])]
      .reverse()
      .find((message) => message.role === 'assistant');

    if (!conversation || !latestAssistantMessage) {
      return;
    }

    this.aiConversationService.updateMessage(conversation.id, latestAssistantMessage.id, { content });
    this.syncAiConversationState();
  }

  getAiMessageLabel(message: AiMessage): string {
    if (message.role === 'user') {
      return 'You';
    }

    if (message.role === 'system') {
      return 'System';
    }

    return 'AI';
  }

  createNewAiConversation(): void {
    if (!this.activeAiConversation) {
      return;
    }

    this.aiConversationService.clearActiveConversation();
    this.syncAiConversationState();
    this.shouldScroll = true;
  }

  deleteAiConversation(conversationId: string): void {
    const conversation = this.aiConversationService.getConversation(conversationId);
    if (!conversation) {
      return;
    }

    const confirmed = window.confirm(`Delete chat session "${conversation.title}"?`);
    if (!confirmed) {
      return;
    }

    this.clearRunningExecutionStatesForConversation(conversation);
    this.clearCommandExplanationStatesForConversation(conversation);
    this.aiConversationService.deleteConversation(conversationId);
    this.syncAiConversationState();
    this.shouldScroll = true;
  }

  deleteAiMessageTurn(conversationId: string, messageId: string): void {
    const conversation = this.aiConversationService.getConversation(conversationId);
    if (!conversation) {
      return;
    }

    const message = conversation.messages.find((currentMessage) => currentMessage.id === messageId);
    if (!message) {
      return;
    }

    const confirmed = window.confirm(
      message.role === 'system'
        ? 'Delete this system message?'
        : 'Delete this question and answer?'
    );
    if (!confirmed) {
      return;
    }

    const messageIdsToRemove = this.getAiMessageTurnIds(conversation, messageId);
    this.clearRunningExecutionStatesForMessageIds(conversation, messageIdsToRemove);
    this.clearCommandExplanationStatesForMessageIds(conversation, messageIdsToRemove);
    this.aiConversationService.removeMessageTurn(conversationId, messageId);
    this.syncAiConversationState();
    this.shouldScroll = true;
  }

  getDeleteAiMessageTitle(message: AiMessage): string {
    return message.role === 'system' ? 'Delete message' : 'Delete this question and answer';
  }

  switchAiConversation(conversationId: string): void {
    this.aiConversationService.setActiveConversation(conversationId);
    this.syncAiConversationState();
    this.shouldScroll = true;
  }

  continueAiConversation(conversationId: string): void {
    this.switchAiConversation(conversationId);
  }

  getConversationSessionName(conversation: AiConversation): string {
    return this.terminalSessions.find((session) => session.id === conversation.terminalSessionId)?.name || 'Saved chat';
  }

  getConversationMessageCount(conversation: AiConversation): number {
    return conversation.messages.length;
  }

  trackByAiConversationId(_: number, conversation: AiConversation): string {
    return conversation.id;
  }

  trackByAiMessageId(_: number, message: AiMessage): string {
    return message.id;
  }

  private getAiMessageTurnIds(conversation: AiConversation, messageId: string): Set<string> {
    const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
    const messageIds = new Set<string>();
    if (messageIndex === -1) {
      return messageIds;
    }

    const targetMessage = conversation.messages[messageIndex];
    if (targetMessage.role === 'user') {
      messageIds.add(targetMessage.id);
      const nextMessage = conversation.messages[messageIndex + 1];
      if (nextMessage?.role === 'assistant') {
        messageIds.add(nextMessage.id);
      }
    } else if (targetMessage.role === 'assistant') {
      const previousMessage = conversation.messages[messageIndex - 1];
      if (previousMessage?.role === 'user') {
        messageIds.add(previousMessage.id);
      }
      messageIds.add(targetMessage.id);
    } else {
      messageIds.add(targetMessage.id);
    }

    return messageIds;
  }

  private clearRunningExecutionStatesForConversation(conversation: AiConversation): void {
    const executionIds = new Set(conversation.executions.map((execution) => execution.id));
    for (const [terminalSessionId, runningExecution] of this.runningExecutionStatesBySession.entries()) {
      if (executionIds.has(runningExecution.executionId)) {
        this.runningExecutionStatesBySession.delete(terminalSessionId);
      }
    }
  }

  private clearRunningExecutionStatesForMessageIds(
    conversation: AiConversation,
    messageIds: Set<string>
  ): void {
    const suggestionIds = this.getSuggestionIdsForMessageIds(conversation, messageIds);
    const executionIds = new Set(
      conversation.executions
        .filter((execution) => execution.suggestionId && suggestionIds.has(execution.suggestionId))
        .map((execution) => execution.id)
    );

    for (const [terminalSessionId, runningExecution] of this.runningExecutionStatesBySession.entries()) {
      if (executionIds.has(runningExecution.executionId)) {
        this.runningExecutionStatesBySession.delete(terminalSessionId);
      }
    }
  }

  private clearCommandExplanationStatesForConversation(conversation: AiConversation): void {
    const suggestionIds = new Set(
      conversation.messages
        .flatMap((message) => message.suggestions || [])
        .map((suggestion) => suggestion.id)
    );
    this.clearCommandExplanationStatesForSuggestionIds(suggestionIds);
  }

  private clearCommandExplanationStatesForMessageIds(
    conversation: AiConversation,
    messageIds: Set<string>
  ): void {
    this.clearCommandExplanationStatesForSuggestionIds(
      this.getSuggestionIdsForMessageIds(conversation, messageIds)
    );
  }

  private clearCommandExplanationStatesForSuggestionIds(suggestionIds: Set<string>): void {
    if (suggestionIds.size === 0) {
      return;
    }

    const nextStates = { ...this.commandExplanationStates };
    for (const suggestionId of suggestionIds) {
      this.commandExplanationAbortControllers.get(suggestionId)?.abort();
      this.commandExplanationAbortControllers.delete(suggestionId);
      delete nextStates[suggestionId];
    }
    this.commandExplanationStates = nextStates;
  }

  private getSuggestionIdsForMessageIds(
    conversation: AiConversation,
    messageIds: Set<string>
  ): Set<string> {
    return new Set(
      conversation.messages
        .filter((message) => messageIds.has(message.id))
        .flatMap((message) => message.suggestions || [])
        .map((suggestion) => suggestion.id)
    );
  }

  // Compatibility path for connection-test messages that still arrive as ChatHistory entries.
  processNewChatEntry(entry: ChatHistory, response: string): void {
    const activeConversation = this.ensureAiConversationForCurrentSession();
    const assistantMessage = this.aiConversationService.addMessage(activeConversation.id, {
      role: 'assistant',
      content: 'Thinking...',
      isCommand: entry.isCommand
    });
    this.processAssistantMessage(activeConversation.id, assistantMessage.id, response, entry.isCommand);
  }

  private addSystemMessageFromChatEntry(entry: ChatHistory): void {
    const activeConversation = this.ensureAiConversationForCurrentSession();
    this.aiConversationService.addMessage(activeConversation.id, {
      role: 'system',
      content: entry.response || entry.message,
      isCommand: entry.isCommand
    });
    this.syncAiConversationState();
    this.shouldScroll = true;
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
        this.addSystemMessageFromChatEntry(entry);
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
        this.addSystemMessageFromChatEntry(entry);
      }
    });
  }

  private loadConnectionProfiles(): void {
    this.connectionProfiles = this.connectionProfileService.listProfiles();
  }

  get localTerminalProfiles(): TerminalProfileViewItem[] {
    return this.getTerminalProfileItems().filter((item) => item.group === 'local');
  }

  get wslTerminalProfiles(): TerminalProfileViewItem[] {
    return this.getTerminalProfileItems().filter((item) => item.group === 'wsl');
  }

  get connectionTerminalProfiles(): TerminalProfileViewItem[] {
    return this.getTerminalProfileItems().filter((item) => item.group === 'connection');
  }

  private getTerminalProfileItems(): TerminalProfileViewItem[] {
    const items: TerminalProfileViewItem[] = [];
    const os = this.detectOperatingSystem();

    if (os === 'Windows') {
      const isCheckingElevation = !this.isProcessElevationStatusLoaded;
      const adminProfileDisabled = isCheckingElevation || !this.isProcessElevated;
      const adminProfileDisabledReason = this.processElevationStatusError
        || (isCheckingElevation
          ? 'Checking whether AI Terminal is running as administrator...'
          : 'Restart AI Terminal as administrator to open this profile.');
      items.push({
        id: 'builtin-powershell',
        source: 'builtin',
        kind: 'local-powershell',
        name: 'PowerShell',
        displayName: 'powershell.exe',
        status: 'Built-in',
        group: 'local',
        editable: false,
        deletable: false,
        probeable: true
      });
      items.push({
        id: 'builtin-powershell-admin',
        source: 'builtin',
        kind: 'local-powershell-admin',
        name: 'PowerShell (Administrator)',
        displayName: this.isProcessElevated ? 'powershell.exe · administrator' : 'Requires app restart as administrator',
        status: 'Built-in',
        group: 'local',
        editable: false,
        deletable: false,
        probeable: true,
        disabled: adminProfileDisabled,
        disabledReason: adminProfileDisabled ? adminProfileDisabledReason : undefined
      });
    } else if (os === 'macOS') {
      items.push({
        id: 'builtin-zsh',
        source: 'builtin',
        kind: 'local-zsh',
        name: 'zsh',
        displayName: '/bin/zsh',
        status: 'Built-in',
        group: 'local',
        editable: false,
        deletable: false,
        probeable: true
      });
    }

    for (const distro of this.wslDistributions) {
      items.push({
        id: `wsl-${distro.name}`,
        source: 'wsl',
        kind: 'local-wsl',
        name: distro.name,
        displayName: `WSL${distro.version ? ` ${distro.version}` : ''}${distro.isDefault ? ' · default' : ''}`,
        status: distro.state,
        group: 'wsl',
        editable: false,
        deletable: false,
        probeable: true,
        wslDistroName: distro.name
      });
    }

    for (const profile of this.connectionProfiles) {
      items.push({
        id: `connection-${profile.id}`,
        source: 'connection',
        kind: profile.type === 'jumpserver' ? 'jumpserver' : 'ssh',
        name: profile.name,
        displayName: this.generateConnectionDisplayName(profile),
        status: this.getConnectionTypeLabel(profile.type),
        group: 'connection',
        editable: true,
        deletable: true,
        probeable: true,
        connectionProfile: profile,
        connectionProfileId: profile.id
      });
    }

    return items;
  }

  async openConnectionManager(): Promise<void> {
    this.loadConnectionProfiles();
    this.isConnectionManagerOpen = true;
    void this.refreshProcessElevationStatus();
    void this.loadWslDistributions();
  }

  closeConnectionManager(): void {
    this.isConnectionManagerOpen = false;
    this.isConnectionFormOpen = false;
  }

  async toggleTerminalLauncher(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    this.isTerminalLauncherOpen = !this.isTerminalLauncherOpen;
  }

  closeTerminalLauncher(): void {
    this.isTerminalLauncherOpen = false;
  }

  selectTerminalFromLauncher(sessionId: string): void {
    this.closeTerminalLauncher();
    this.switchToSession(sessionId);
  }

  getTerminalSessionKindLabel(session: TerminalSession): string {
    if (session.connectionState === 'connecting') {
      return 'Connecting';
    }

    if (session.connectionState === 'failed') {
      return 'Failed';
    }

    if (session.connectionState === 'disconnected') {
      return 'Disconnected';
    }

    if (session.connectionState === 'ended') {
      return 'Ended';
    }

    if (session.connectionProfileId) {
      return session.terminalKind === 'jumpserver' ? 'JumpServer' : 'SSH';
    }

    if (session.terminalKind === 'local-wsl') {
      return 'WSL';
    }

    if (session.terminalKind === 'local-zsh') {
      return 'zsh';
    }

    return 'PowerShell';
  }

  getActiveTerminalSessionNotice(): string {
    const session = this.terminalSessions.find((candidate) => candidate.id === this.activeSessionId);
    if (!session) {
      return '';
    }

    if (session.connectionState === 'connecting') {
      return `Connecting ${session.name}...`;
    }

    if (session.connectionState === 'failed') {
      return `Connection failed: ${session.connectionEndReason || 'SSH could not connect.'}`;
    }

    if (session.connectionState === 'disconnected') {
      return `Connection disconnected: ${session.connectionEndReason || 'Remote connection closed.'}`;
    }

    if (session.connectionState === 'ended') {
      return session.connectionEndReason || 'Remote session ended.';
    }

    return '';
  }

  getActiveTerminalSessionNoticeClass(): string {
    const session = this.terminalSessions.find((candidate) => candidate.id === this.activeSessionId);
    if (session?.connectionState === 'failed') {
      return 'terminal-session-notice terminal-session-notice-error';
    }

    if (session?.connectionState === 'disconnected') {
      return 'terminal-session-notice terminal-session-notice-warning';
    }

    return 'terminal-session-notice';
  }

  private loadWslDistributions(forceRefresh = false): Promise<void> {
    if (this.detectOperatingSystem() !== 'Windows') {
      this.wslDistributions = [];
      return Promise.resolve();
    }

    if (this.wslDistributionsLoaded && !forceRefresh) {
      return Promise.resolve();
    }

    if (this.wslDistributionsLoadPromise) {
      return this.wslDistributionsLoadPromise;
    }

    const now = Date.now();
    if (!forceRefresh && this.lastWslDistributionsLoadAttemptAt > 0 && now - this.lastWslDistributionsLoadAttemptAt < 30000) {
      return Promise.resolve();
    }

    this.lastWslDistributionsLoadAttemptAt = now;
    this.isLoadingTerminalProfiles = true;
    this.terminalProfilesStatus = '';
    this.wslDistributionsLoadPromise = invoke<WslDistribution[]>('list_wsl_distributions')
      .then((distributions) => {
        this.wslDistributions = distributions;
        this.terminalProfilesStatus = '';
        this.wslDistributionsLoaded = true;
      })
      .catch((error: any) => {
        this.wslDistributions = [];
        this.terminalProfilesStatus = `Could not load WSL distributions: ${error.message || error}`;
      })
      .finally(() => {
        this.isLoadingTerminalProfiles = false;
        this.wslDistributionsLoadPromise = null;
      });

    return this.wslDistributionsLoadPromise;
  }

  closeConnectionForm(): void {
    this.isConnectionFormOpen = false;
  }

  private async refreshProcessElevationStatus(): Promise<void> {
    if (this.detectOperatingSystem() !== 'Windows') {
      this.isProcessElevated = false;
      this.isProcessElevationStatusLoaded = true;
      this.processElevationStatusError = '';
      return;
    }

    try {
      this.processElevationStatusError = '';
      this.isProcessElevated = await invoke<boolean>('is_process_elevated');
    } catch (error: any) {
      this.isProcessElevated = false;
      this.processElevationStatusError = `Could not verify administrator status: ${error.message || error}`;
    } finally {
      this.isProcessElevationStatusLoaded = true;
    }
  }

  openDefaultTerminalSession(): void {
    const defaultTerminalKind = this.getDefaultTerminalKind();
    this.createNewSession(
      this.getDefaultTerminalName(defaultTerminalKind),
      true,
      undefined,
      defaultTerminalKind
    );
  }

  private getDefaultTerminalKind(): TerminalProfileKind {
    return this.detectOperatingSystem() === 'macOS' ? 'local-zsh' : 'local-powershell';
  }

  private getDefaultTerminalName(kind: TerminalProfileKind): string {
    if (kind === 'local-zsh') {
      return 'zsh';
    }

    return 'PowerShell';
  }

  async openTerminalProfile(item: TerminalProfileViewItem): Promise<void> {
    if (item.disabled) {
      this.connectionStatus = item.disabledReason || 'This terminal profile is not available yet.';
      return;
    }

    this.closeTerminalLauncher();
    if (this.isConnectionManagerOpen) {
      this.closeConnectionManager();
    }

    if (item.source === 'connection' && item.connectionProfile) {
      await this.connectConnectionProfile(item.connectionProfile);
      return;
    }

    if (item.kind === 'local-wsl') {
      this.createNewSession(item.name, true, undefined, 'local-wsl', item.wslDistroName);
      return;
    }

    this.createNewSession(item.name, true, undefined, item.kind);
  }

  editTerminalProfile(item: TerminalProfileViewItem): void {
    if (item.connectionProfile) {
      this.editConnectionProfile(item.connectionProfile);
    }
  }

  duplicateTerminalProfile(item: TerminalProfileViewItem): void {
    if (item.connectionProfile) {
      this.duplicateConnectionProfile(item.connectionProfile);
    }
  }

  deleteTerminalProfile(item: TerminalProfileViewItem): void {
    if (item.connectionProfile) {
      this.deleteConnectionProfile(item.connectionProfile);
    }
  }

  async probeTerminalProfile(item: TerminalProfileViewItem): Promise<void> {
    if (!item.connectionProfile) {
      this.connectionStatus = 'Local terminal probing will be implemented later.';
      return;
    }

    this.editConnectionProfile(item.connectionProfile);
    await this.probeConnectionProfileFromForm();
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

  async saveConnectionProfile(): Promise<void> {
    const payload = this.formToProfileInput();
    if (!payload.name?.trim()) {
      this.connectionStatus = 'Connection name is required.';
      return;
    }

    if (this.connectionFormMode === 'edit' && this.editingConnectionProfileId) {
      await this.persistServerContextFileForProfile(this.editingConnectionProfileId, payload);
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
    await this.persistServerContextFileForProfile(createdProfile.id, payload);
    const profileWithContextPath = this.connectionProfileService.updateProfile(createdProfile.id, payload) || createdProfile;
    this.loadConnectionProfiles();
    this.connectionFormMode = 'edit';
    this.editingConnectionProfileId = profileWithContextPath.id;
    this.connectionForm = this.profileToForm(profileWithContextPath);
    this.connectionStatus = `Created ${profileWithContextPath.name}.`;
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

  private async persistServerContextFileForProfile(
    profileId: string,
    payload: CreateConnectionProfileInput | UpdateConnectionProfilePatch
  ): Promise<void> {
    const context = typeof payload.serverContext === 'string' ? payload.serverContext : '';
    if (!context.trim()) {
      payload.serverContextPath = undefined;
      return;
    }

    try {
      const path = await invoke<string>('save_server_context_file', {
        profileId,
        context
      });
      payload.serverContextPath = path;
      this.connectionForm.serverContextPath = path;
    } catch (error: any) {
      const message = error?.message || error;
      this.connectionStatus = `Saved profile data, but failed to write server context file: ${message}`;
    }
  }

  async probeConnectionProfileFromForm(): Promise<void> {
    if (this.isProbingConnectionProfile) {
      return;
    }

    let probeSessionId = '';
    const startedAt = new Date().toISOString();
    const probeDebugLogs: string[] = [];
    const logProbeDebug: ProbeDebugLogger = (message: string) => {
      const line = `[PROBE-DEBUG] ${new Date().toISOString()} ${message}`;
      probeDebugLogs.push(line);
      console.debug(line);
    };
    try {
      const profile = this.buildConnectionProfileFromFormForProbe();
      const useDirectSshProbe = profile.type === 'ssh';
      const sshCommand = useDirectSshProbe
        ? this.connectionCommandService.buildDirectProbeSshCommand(profile, this.detectOperatingSystem())
        : this.buildSshCommand(profile);
      probeSessionId = this.createClientId('probe-session');
      logProbeDebug(`created probe session ${probeSessionId}`);
      this.isProbingConnectionProfile = true;
      this.probeStatus = 'Connecting and waiting for a stable prompt...';
      this.connectionStatus = this.probeStatus;
      this.ptyBufferBySession.set(probeSessionId, '');
      this.ptyRawBufferBySession.set(probeSessionId, '');
      this.registerActiveConnectionRuntime(probeSessionId, profile);

      await invoke<void>('pty_create_session', {
        sessionId: probeSessionId,
        cols: 120,
        rows: 40
      });
      this.ptySessions.add(probeSessionId);
      logProbeDebug('created local PTY shell');

      await invoke<void>('pty_write', {
        sessionId: probeSessionId,
        data: this.withTerminalSubmitSequence(sshCommand)
      });
      logProbeDebug(`sent ssh command, bufferLength=${(this.ptyRawBufferBySession.get(probeSessionId) || '').length}`);

      const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const startMarker = `__AI_TERMINAL_PROBE_START_${nonce}__`;
      const endMarker = `__AI_TERMINAL_PROBE_END_${nonce}__`;
      const probeScriptLines = this.connectionProbeLogicService.buildServerProbeScriptLines(startMarker, endMarker);
      let outputStartLength = 0;

      if (useDirectSshProbe) {
        await this.waitForProbeRemoteCommandReady(probeSessionId, logProbeDebug);
        outputStartLength = (this.ptyRawBufferBySession.get(probeSessionId) || '').length;
        logProbeDebug(`direct ssh probe ready, outputStartLength=${outputStartLength}, scriptLineCount=${probeScriptLines.length}`);
      } else {
        await this.waitForProbeConnectionReady(probeSessionId, logProbeDebug);
        outputStartLength = (this.ptyRawBufferBySession.get(probeSessionId) || '').length;
        logProbeDebug(`interactive probe ready, outputStartLength=${outputStartLength}, scriptLineCount=${probeScriptLines.length}`);
      }

      this.probeStatus = 'Running read-only probe commands...';
      this.connectionStatus = this.probeStatus;
      if (useDirectSshProbe) {
        await this.writeDirectProbeScript(probeSessionId, probeScriptLines, logProbeDebug);
      } else {
        await this.writeInteractiveProbeScript(probeSessionId, probeScriptLines, logProbeDebug);
      }

      const rawProbeOutput = await this.waitForProbeOutput(
        probeSessionId,
        outputStartLength,
        startMarker,
        endMarker,
        logProbeDebug
      );
      const serverContext = this.connectionProbeLogicService.buildServerContextFromProbe(profile, rawProbeOutput, startedAt);
      this.connectionForm.serverContext = serverContext;
      this.connectionForm.probeRawOutput = this.connectionProbeLogicService.withProbeDebugOutput(probeDebugLogs, rawProbeOutput);
      this.connectionForm.probeUpdatedAt = startedAt;

      if (this.connectionFormMode === 'edit' && this.editingConnectionProfileId) {
        const patch: UpdateConnectionProfilePatch = {
          serverContext,
          probeRawOutput: this.connectionForm.probeRawOutput,
          probeUpdatedAt: startedAt
        };
        await this.persistServerContextFileForProfile(this.editingConnectionProfileId, patch);
        if (patch.serverContextPath) {
          this.connectionForm.serverContextPath = patch.serverContextPath;
        }
        this.connectionProfileService.updateProfile(this.editingConnectionProfileId, patch);
        this.loadConnectionProfiles();
      }

      this.probeStatus = `Probe completed at ${this.formatConnectionTime(startedAt)}.`;
      this.connectionStatus = this.probeStatus;
    } catch (error: any) {
      const rawOutput = probeSessionId ? this.ptyRawBufferBySession.get(probeSessionId) || '' : '';
      const cleanOutput = this.connectionProbeLogicService.normalizeTerminalOutput(rawOutput);
      const message = this.connectionProbeLogicService.formatProbeFailureMessage(error, cleanOutput);
      this.probeStatus = `Probe failed: ${message}`;
      this.connectionStatus = this.probeStatus;
      if (probeSessionId) {
        this.connectionForm.probeRawOutput = this.connectionProbeLogicService.withProbeDebugOutput(probeDebugLogs, cleanOutput.slice(-8000));
      }
    } finally {
      this.isProbingConnectionProfile = false;
      if (probeSessionId) {
        this.activeConnectionRuntimes.delete(probeSessionId);
        this.ptySessions.delete(probeSessionId);
        this.pendingPtySessions.delete(probeSessionId);
        this.ptySessionPromises.delete(probeSessionId);
        this.ptyBufferBySession.delete(probeSessionId);
        this.ptyRawBufferBySession.delete(probeSessionId);
        this.ptyDisplayEpochBySession.delete(probeSessionId);
        this.authPromptReplayFilteredSessions.delete(probeSessionId);
        this.autoInputReplayValuesBySession.delete(probeSessionId);
        this.postAutoInputNormalizeBudgetBySession.delete(probeSessionId);
        void invoke<void>('pty_close_session', { sessionId: probeSessionId }).catch(() => undefined);
      }
    }
  }

  private buildConnectionProfileFromFormForProbe(): ConnectionProfile {
    const payload = this.formToProfileInput() as CreateConnectionProfileInput;
    if (payload.authMethod === 'manual') {
      throw new Error('Probe cannot run with Manual auth. Use Password, Private Key, or SSH Agent for background probing.');
    }
    const profile = this.connectionProfileService.createDefaultProfile({
      ...payload,
      name: payload.name?.trim() || 'Probe Connection',
      type: payload.type || this.connectionForm.type
    });
    return {
      ...profile,
      id: this.editingConnectionProfileId || this.createClientId('probe-profile')
    };
  }

  private async waitForProbeConnectionReady(
    sessionId: string,
    logProbeDebug?: ProbeDebugLogger,
    timeoutMs: number = 30000,
    quietMs: number = 3500
  ): Promise<void> {
    const startedAt = Date.now();
    let lastLength = (this.ptyRawBufferBySession.get(sessionId) || '').length;
    let lastChangedAt = startedAt;
    let loggedAuthPrompt = false;
    let loggedAuthPromptAttempt = false;

    while (Date.now() - startedAt < timeoutMs) {
      await this.sleep(200);
      const output = this.connectionProbeLogicService.normalizeTerminalOutput(this.ptyRawBufferBySession.get(sessionId) || '');
      const runtime = this.activeConnectionRuntimes.get(sessionId);
      const authPromptAutomationPending = runtime ? this.hasPendingAuthPromptAutomation(runtime) : false;
      const hasPrompt = this.connectionProbeLogicService.hasLikelyShellPrompt(output);
      if (!hasPrompt && this.connectionProbeLogicService.hasProbeConnectionFailure(output)) {
        throw new Error(`Connection failed before probe could run.\n${output.slice(-1200)}`);
      }

      if (authPromptAutomationPending && !hasPrompt && this.connectionProbeLogicService.hasPasswordPrompt(this.getPtyOutputTail(sessionId))) {
        if (!loggedAuthPrompt) {
          logProbeDebug?.(`auth prompt detected, outputLength=${output.length}`);
          loggedAuthPrompt = true;
        }
        lastChangedAt = Date.now();
        continue;
      }

      if (authPromptAutomationPending && !hasPrompt) {
        lastChangedAt = Date.now();
        continue;
      }
      if (runtime?.passwordAttempted && !loggedAuthPromptAttempt) {
        logProbeDebug?.(`auth prompt automation attempted, outputLength=${output.length}`);
        loggedAuthPromptAttempt = true;
      }

      const currentLength = output.length;
      if (currentLength !== lastLength) {
        logProbeDebug?.(`connection output changed ${lastLength}->${currentLength}`);
        lastLength = currentLength;
        lastChangedAt = Date.now();
      }

      if (currentLength > 0 && Date.now() - lastChangedAt >= quietMs) {
        logProbeDebug?.(`connection considered ready after ${Date.now() - lastChangedAt}ms quiet, outputLength=${currentLength}`);
        return;
      }
    }

    throw new Error(`Timed out waiting for SSH/JumpServer prompt.\n${this.connectionProbeLogicService.normalizeTerminalOutput(this.getPtyOutputTail(sessionId))}`);
  }

  private async waitForProbeRemoteCommandReady(
    sessionId: string,
    logProbeDebug?: ProbeDebugLogger,
    timeoutMs: number = 30000,
    quietMs: number = 1000
  ): Promise<void> {
    const startedAt = Date.now();
    let lastLength = (this.ptyRawBufferBySession.get(sessionId) || '').length;
    let lastChangedAt = startedAt;
    let loggedAuthPrompt = false;
    let loggedAuthPromptAttempt = false;

    while (Date.now() - startedAt < timeoutMs) {
      await this.sleep(200);
      const output = this.connectionProbeLogicService.normalizeTerminalOutput(this.ptyRawBufferBySession.get(sessionId) || '');
      if (this.connectionProbeLogicService.hasProbeConnectionFailure(output)) {
        throw new Error(`Connection failed before probe could run.\n${output.slice(-1200)}`);
      }

      const runtime = this.activeConnectionRuntimes.get(sessionId);
      const authPromptAutomationPending = runtime ? this.hasPendingAuthPromptAutomation(runtime) : false;
      if (authPromptAutomationPending && this.connectionProbeLogicService.hasPasswordPrompt(this.getPtyOutputTail(sessionId))) {
        if (!loggedAuthPrompt) {
          logProbeDebug?.(`auth prompt detected for direct probe, outputLength=${output.length}`);
          loggedAuthPrompt = true;
        }
        lastChangedAt = Date.now();
        continue;
      }

      if (authPromptAutomationPending) {
        lastChangedAt = Date.now();
        continue;
      }
      if (runtime?.passwordAttempted && !loggedAuthPromptAttempt) {
        logProbeDebug?.(`auth prompt automation attempted for direct probe, outputLength=${output.length}`);
        loggedAuthPromptAttempt = true;
      }

      const currentLength = output.length;
      if (currentLength !== lastLength) {
        logProbeDebug?.(`direct probe connection output changed ${lastLength}->${currentLength}`);
        lastLength = currentLength;
        lastChangedAt = Date.now();
      }

      if (Date.now() - startedAt >= quietMs && Date.now() - lastChangedAt >= quietMs) {
        logProbeDebug?.(`direct ssh remote command considered ready after ${Date.now() - lastChangedAt}ms quiet, outputLength=${currentLength}`);
        return;
      }
    }

    throw new Error(`Timed out waiting for SSH remote probe command.\n${this.connectionProbeLogicService.normalizeTerminalOutput(this.getPtyOutputTail(sessionId))}`);
  }

  private async waitForProbeOutput(
    sessionId: string,
    outputStartLength: number,
    startMarker: string,
    endMarker: string,
    logProbeDebug?: ProbeDebugLogger,
    timeoutMs: number = 30000
  ): Promise<string> {
    const startedAt = Date.now();
    let lastLength = 0;

    while (Date.now() - startedAt < timeoutMs) {
      await this.sleep(200);
      const output = this.connectionProbeLogicService.normalizeTerminalOutput(
        (this.ptyRawBufferBySession.get(sessionId) || '').slice(outputStartLength)
      );
      if (output.length !== lastLength) {
        logProbeDebug?.(`probe output changed ${lastLength}->${output.length}, hasStart=${output.includes(startMarker)}, hasEnd=${output.includes(endMarker)}`);
        lastLength = output.length;
      }
      if (this.connectionProbeLogicService.hasProbeTransportFailure(output)) {
        throw new Error(`Probe command failed because the connection ended.\n${output.slice(-1200)}`);
      }

      const startIndex = output.indexOf(startMarker);
      const endIndex = output.indexOf(endMarker);
      if (startIndex >= 0 && endIndex > startIndex) {
        const rawResult = output
          .slice(startIndex + startMarker.length, endIndex)
          .replace(/\r/g, '')
          .trim();
        return this.connectionProbeLogicService.extractStructuredProbeOutput(rawResult);
      }
    }

    throw new Error(`Timed out waiting for probe output.\n${this.connectionProbeLogicService.normalizeTerminalOutput(this.getPtyOutputTail(sessionId))}`);
  }

  private async writeDirectProbeScript(
    sessionId: string,
    scriptLines: string[],
    logProbeDebug?: ProbeDebugLogger
  ): Promise<void> {
    const beforeLength = (this.ptyRawBufferBySession.get(sessionId) || '').length;
    const payload = [...scriptLines, 'exit 0']
      .map((line) => this.withRemoteTerminalSubmitSequence(line))
      .join('');
    logProbeDebug?.(`writing direct probe script, lineCount=${scriptLines.length}, length=${payload.length}, beforeBuffer=${beforeLength}`);
    await invoke<void>('pty_write', { sessionId, data: payload });
    await this.sleep(300);
    const afterLength = (this.ptyRawBufferBySession.get(sessionId) || '').length;
    logProbeDebug?.(`wrote direct probe script, afterBuffer=${afterLength}`);
  }

  private async writeInteractiveProbeScript(
    sessionId: string,
    scriptLines: string[],
    logProbeDebug?: ProbeDebugLogger
  ): Promise<void> {
    const beforeLength = (this.ptyRawBufferBySession.get(sessionId) || '').length;
    const payload = [
      'stty -echo 2>/dev/null || true',
      "sh <<'__AI_TERMINAL_PROBE_SCRIPT__'",
      ...scriptLines,
      '__AI_TERMINAL_PROBE_SCRIPT__',
      'stty echo 2>/dev/null || true'
    ].map((line) => this.withRemoteTerminalSubmitSequence(line)).join('');
    logProbeDebug?.(`writing probe script, lineCount=${scriptLines.length}, length=${payload.length}, beforeBuffer=${beforeLength}`);
    await invoke<void>('pty_write', { sessionId, data: payload });
    await this.sleep(300);
    const afterLength = (this.ptyRawBufferBySession.get(sessionId) || '').length;
    logProbeDebug?.(`wrote probe script, afterBuffer=${afterLength}`);
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async connectConnectionProfile(profile: ConnectionProfile): Promise<void> {
    const displayName = this.generateConnectionDisplayName(profile);
    let sessionId = '';

    try {
      const launchCommand = this.connectionCommandService.buildSshLaunchCommand(profile);
      const createdSession = this.terminalSessionService.createNewSession(
        this.terminalSessions,
        displayName,
        false,
        profile.id,
        profile.type === 'jumpserver' ? 'jumpserver' : 'ssh',
        undefined,
        launchCommand,
        'connecting'
      );
      this.terminalSessions = createdSession.sessions;
      sessionId = createdSession.sessionId;
      this.registerActiveConnectionRuntime(sessionId, profile);
      this.switchToSession(sessionId);
      await this.ensurePtySession(sessionId);
      this.connectionStatus = `Connecting ${displayName}.`;
      this.isConnectionManagerOpen = false;
      this.isConnectionFormOpen = false;
    } catch (error: any) {
      this.connectionStatus = `Failed to connect ${displayName}: ${error.message || error}`;
      if (sessionId) {
        this.markConnectionSessionTerminated(sessionId, 'failed', error.message || String(error || 'Failed to start SSH.'));
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
      profileSnapshot: { ...profile, autoInputRules: profile.autoInputRules.map((rule) => ({ ...rule })) },
      passwordAttempted: false,
      connected: false,
      pendingAutoInputRuleIds: [],
      firedAutoInputRuleIds: [],
      createdAt: new Date().toISOString()
    });
  }

  private async handleConnectionAutomation(sessionId: string): Promise<boolean> {
    const runtime = this.activeConnectionRuntimes.get(sessionId);
    if (!runtime) {
      return false;
    }

    const submittedAuthPrompt = await this.handleAuthPromptAutomation(runtime);
    if (submittedAuthPrompt) {
      return true;
    }

    const submittedAutoInput = await this.handleJumpServerAutoInputRules(runtime);
    return submittedAutoInput;
  }

  private async handleAuthPromptAutomation(runtime: ActiveConnectionRuntime): Promise<boolean> {
    if (runtime.passwordAttempted) {
      return false;
    }

    const profile = this.getConnectionRuntimeProfile(runtime);
    if (!profile) {
      return false;
    }

    const promptSecret = this.getConnectionAuthPromptSecret(profile);
    if (!promptSecret) {
      return false;
    }

    const outputTail = this.getPtyOutputTail(runtime.terminalSessionId);
    if (!this.connectionProbeLogicService.hasPasswordPrompt(outputTail)) {
      return false;
    }

    runtime.passwordAttempted = true;
    this.authPromptReplayFilteredSessions.add(runtime.terminalSessionId);
    this.clearConnectionDisplayBeforeAutoInput(runtime.terminalSessionId);
    try {
      await invoke<void>('pty_write', {
        sessionId: runtime.terminalSessionId,
        data: this.withTerminalSubmitSequence(promptSecret)
      });
    } catch (error) {
      console.error(`Failed to submit SSH auth prompt secret for session ${runtime.terminalSessionId}:`, error);
    }
    return true;
  }

  private hasPendingAuthPromptAutomation(runtime: ActiveConnectionRuntime): boolean {
    if (runtime.passwordAttempted) {
      return false;
    }

    const profile = this.getConnectionRuntimeProfile(runtime);
    return !!profile && !!this.getConnectionAuthPromptSecret(profile);
  }

  private getConnectionAuthPromptSecret(profile: ConnectionProfile): string | undefined {
    if (profile.authMethod === 'privateKey') {
      return profile.privateKeyPassphrase;
    }

    if (profile.authMethod === 'password') {
      if (profile.type === 'jumpserver') {
        return profile.jumpPassword;
      }

      return profile.targetPassword;
    }

    return undefined;
  }

  private getPtyOutputTail(sessionId: string): string {
    const output = this.ptyRawBufferBySession.get(sessionId) || '';
    return output.slice(-4000);
  }

  private markConnectionSessionTerminated(
    sessionId: string,
    state: Extract<TerminalConnectionState, 'failed' | 'disconnected' | 'ended'>,
    reason: string
  ): void {
    const endedAt = new Date().toISOString();
    const cleanReason = this.connectionProbeLogicService.normalizeTerminalOutput(reason).trim() || 'Connection ended.';
    this.activeConnectionRuntimes.delete(sessionId);
    this.terminalSessions = this.terminalSessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            isSshSessionActive: false,
            currentSshUserHost: null,
            connectionState: state,
            connectionEndReason: cleanReason,
            connectionEndedAt: endedAt
          }
        : session
    );

    if (this.activeSessionId === sessionId) {
      this.isSshSessionActive = false;
      this.currentSshUserHost = null;
      this.updateTerminalInputMode();
    }
  }

  private isTerminalSessionWritable(sessionId: string): boolean {
    const session = this.terminalSessions.find((candidate) => candidate.id === sessionId);
    return !this.isTerminalSessionTerminated(session);
  }

  private isTerminalSessionTerminated(session?: TerminalSession): boolean {
    return session?.connectionState === 'failed' ||
      session?.connectionState === 'disconnected' ||
      session?.connectionState === 'ended';
  }

  private updateTerminalInputMode(): void {
    if (!this.terminal) {
      return;
    }

    this.terminal.options.disableStdin = !this.isTerminalSessionWritable(this.activeSessionId);
  }

  buildSshCommand(profile: ConnectionProfile): string {
    return this.connectionCommandService.buildSshCommand(profile, this.detectOperatingSystem());
  }

  private async handleJumpServerAutoInputRules(runtime: ActiveConnectionRuntime): Promise<boolean> {
    if (runtime.profileType !== 'jumpserver') {
      return false;
    }

    const profile = this.getConnectionRuntimeProfile(runtime);
    if (!profile) {
      return false;
    }

    const outputTail = this.getPtyOutputTail(runtime.terminalSessionId);
    const enabledRules = profile.autoInputRules.filter((rule) => rule.enabled);
    let submittedAutoInput = false;
    for (const rule of enabledRules) {
      if (runtime.firedAutoInputRuleIds.includes(rule.id) || runtime.pendingAutoInputRuleIds.includes(rule.id)) {
        continue;
      }

      if (!this.connectionProbeLogicService.doesAutoInputRuleMatch(rule, outputTail)) {
        continue;
      }

      const input = this.getAutoInputValue(rule, profile);
      if (!input) {
        continue;
      }

      this.logConnectionDisplayDebug('jumpserver auto input rule matched', {
        sessionId: runtime.terminalSessionId,
        ruleId: rule.id,
        patternLength: rule.whenOutputMatches.length,
        inputLength: input.length,
        appendEnter: rule.appendEnter,
        outputTail: this.describeTerminalDataForDebug(outputTail)
      });
      runtime.pendingAutoInputRuleIds.push(rule.id);
      this.clearConnectionDisplayBeforeAutoInput(runtime.terminalSessionId);
      this.queueConnectionInputEchoSuppression(runtime.terminalSessionId, input);
      this.rememberAutoInputReplayValue(runtime.terminalSessionId, input);
      this.postAutoInputNormalizeBudgetBySession.set(runtime.terminalSessionId, 12);
      try {
        await invoke<void>('pty_write', {
          sessionId: runtime.terminalSessionId,
          data: rule.appendEnter ? this.withTerminalSubmitSequence(input) : input
        });
        runtime.firedAutoInputRuleIds.push(rule.id);
        submittedAutoInput = true;
      } catch (error) {
        console.error(`Failed to submit JumpServer auto input for session ${runtime.terminalSessionId}:`, error);
      } finally {
        runtime.pendingAutoInputRuleIds = runtime.pendingAutoInputRuleIds.filter(
          (pendingRuleId) => pendingRuleId !== rule.id
        );
      }
    }
    return submittedAutoInput;
  }

  private clearConnectionDisplayBeforeAutoInput(sessionId: string): void {
    this.ptyBufferBySession.set(sessionId, '');
    this.ptyDisplayEpochBySession.set(
      sessionId,
      (this.ptyDisplayEpochBySession.get(sessionId) || 0) + 1
    );
    this.logConnectionDisplayDebug('truncated connection display before auto input', {
      sessionId,
      rawBufferLength: (this.ptyRawBufferBySession.get(sessionId) || '').length,
      displayEpoch: this.ptyDisplayEpochBySession.get(sessionId) || 0
    });
    if (sessionId === this.activeSessionId && this.terminal) {
      this.clearTerminalDisplayAndScrollback();
    }
  }

  private clearTerminalDisplayAndScrollback(): void {
    if (!this.terminal) {
      return;
    }

    this.terminal.reset();
    this.terminal.clear();
  }

  private recreateInteractiveTerminalForReplay(): void {
    const terminalContainer = this.terminalContainerRef?.nativeElement;
    if (!terminalContainer) {
      return;
    }

    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
    terminalContainer.replaceChildren();
    this.createInteractiveTerminalInstance();
  }

  private queueConnectionInputEchoSuppression(sessionId: string, input: string): void {
    if (!input) {
      return;
    }

    const hiddenEchoes = this.hiddenConnectionInputEchoesBySession.get(sessionId) || [];
    hiddenEchoes.push({
      remaining: input,
      missedChunks: 0
    });
    this.hiddenConnectionInputEchoesBySession.set(sessionId, hiddenEchoes);
    this.logConnectionDisplayDebug('queued connection input echo suppression', {
      sessionId,
      inputLength: input.length,
      hiddenEchoCount: hiddenEchoes.length
    });
  }

  private rememberAutoInputReplayValue(sessionId: string, input: string): void {
    if (!input) {
      return;
    }

    const replayValues = this.autoInputReplayValuesBySession.get(sessionId) || [];
    if (!replayValues.includes(input)) {
      replayValues.push(input);
      this.autoInputReplayValuesBySession.set(sessionId, replayValues);
    }
  }

  private logConnectionDisplayDebug(message: string, details?: Record<string, unknown>): void {
    if (globalThis.localStorage?.getItem('ai-terminal.debug.connection-display') !== '1') {
      return;
    }

    console.debug(`[CONNECTION-DISPLAY] ${message}`, details || {});
  }

  private describeTerminalDataForDebug(data: string): Record<string, unknown> {
    const normalizedLines = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let longestBlankRun = 0;
    let currentBlankRun = 0;
    for (const line of normalizedLines) {
      if (line.trim().length === 0) {
        currentBlankRun += 1;
        longestBlankRun = Math.max(longestBlankRun, currentBlankRun);
      } else {
        currentBlankRun = 0;
      }
    }

    return {
      length: data.length,
      crlfCount: (data.match(/\r\n/g) || []).length,
      crOnlyCount: (data.match(/\r(?!\n)/g) || []).length,
      lfOnlyCount: (data.match(/(?<!\r)\n/g) || []).length,
      longestBlankRun,
      containsEscK: data.includes('\x1b[K'),
      containsConnecting: /\*{3}\.\.\.Connecting\.\.\.\*{3}/i.test(data),
      containsWelcome: /Welcome to /i.test(data),
      containsDocumentation: /Documentation:/i.test(data),
      containsLastLogin: /Last login:/i.test(data),
      containsJumpServer: /JumpServer/i.test(data),
      containsHostPrompt: /(?:主机IP|选择组)/i.test(data),
      preview: this.escapeTerminalDataForDebug(data, 900),
      tailPreview: this.escapeTerminalDataForDebug(data.slice(-500), 500)
    };
  }

  private escapeTerminalDataForDebug(data: string, maxLength: number): string {
    const truncated = data.length > maxLength ? `${data.slice(0, maxLength)}...<truncated>` : data;
    return truncated
      .replace(/\x1b/g, '<ESC>')
      .replace(/\r/g, '<CR>')
      .replace(/\n/g, '<LF>')
      .replace(/\t/g, '<TAB>')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, (char) =>
        `<0x${char.charCodeAt(0).toString(16).padStart(2, '0')}>`
      );
  }

  private getAutoInputValue(rule: AutoInputRule, profile: ConnectionProfile): string {
    const configuredInput = rule.input.trim();
    if (configuredInput) {
      return configuredInput;
    }

    return profile.targetHost?.trim() || '';
  }

  private getConnectionRuntimeProfile(runtime: ActiveConnectionRuntime): ConnectionProfile | undefined {
    return runtime.profileSnapshot || this.connectionProfileService.getProfile(runtime.profileId);
  }

  private markSessionConnected(sessionId: string, profile: ConnectionProfile): void {
    const userHost = this.connectionCommandService.getSshUserHost(profile);
    this.terminalSessions = this.terminalSessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            connectionProfileId: profile.id,
            isSshSessionActive: true,
            currentSshUserHost: userHost,
            connectionState: 'connected',
            connectionEndReason: undefined,
            connectionEndedAt: undefined
          }
        : session
    );

    if (this.activeSessionId === sessionId) {
      this.isSshSessionActive = true;
      this.currentSshUserHost = userHost;
      this.updateTerminalInputMode();
    }
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

  getCurrentConnectionContext(sessionId: string = this.activeSessionId): CurrentConnectionContext | undefined {
    if (!sessionId) {
      return undefined;
    }

    const runtime = this.activeConnectionRuntimes.get(sessionId);
    const sessionProfileId = this.terminalSessions.find((session) => session.id === sessionId)?.connectionProfileId;
    const profileId = runtime?.profileId || sessionProfileId;
    if (!profileId) {
      return undefined;
    }

    const profile = this.connectionProfileService.getProfile(profileId);
    if (!profile) {
      return undefined;
    }

    return {
      terminalSessionId: sessionId,
      profileId: profile.id,
      profileType: profile.type,
      displayName: this.generateConnectionDisplayName(profile),
      targetHost: profile.targetHost,
      targetUser: profile.targetUser,
      jumpHost: profile.jumpHost,
      jumpUser: profile.jumpUser
    };
  }

  private getTerminalAssistantEnvironmentContext(
    sessionId: string = this.activeSessionId
  ): TerminalAssistantEnvironmentContext | undefined {
    const session = this.terminalSessions.find((candidate) => candidate.id === sessionId);
    if (!session?.connectionProfileId) {
      if (session?.terminalKind === 'local-wsl') {
        return {
          terminalKind: session.terminalKind,
          wslDistroName: session.wslDistroName
        };
      }

      if (session?.terminalKind === 'local-zsh') {
        return {
          terminalKind: session.terminalKind
        };
      }

      return undefined;
    }

    const profile = this.connectionProfileService.getProfile(session.connectionProfileId);
    if (!profile) {
      return undefined;
    }

    return {
      terminalKind: session.terminalKind,
      connectionType: profile.type === 'jumpserver' ? 'JumpServer SSH' : 'SSH',
      profileName: profile.name,
      targetHost: profile.targetHost,
      targetUser: profile.targetUser,
      wslDistroName: session.wslDistroName,
      serverContext: profile.serverContext
    };
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

  trackByTerminalProfileId(_: number, item: TerminalProfileViewItem): string {
    return item.id;
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
      privateKeyPassphrase: '',
      autoInputRules: [],
      tagsText: '',
      description: '',
      serverContext: '',
      serverContextPath: '',
      probeRawOutput: '',
      probeUpdatedAt: ''
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
      privateKeyPassphrase: profile.privateKeyPassphrase || '',
      autoInputRules: profile.autoInputRules.map((rule) => ({ ...rule })),
      tagsText: profile.tags.join(', '),
      description: profile.description || '',
      serverContext: profile.serverContext || '',
      serverContextPath: profile.serverContextPath || '',
      probeRawOutput: profile.probeRawOutput || '',
      probeUpdatedAt: profile.probeUpdatedAt || ''
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
      privateKeyPassphrase: this.rawEmptyToUndefined(this.connectionForm.privateKeyPassphrase),
      autoInputRules: this.connectionForm.autoInputRules.map((rule) => ({ ...rule })),
      tags: this.connectionForm.tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
      description: this.emptyToUndefined(this.connectionForm.description),
      serverContext: this.rawEmptyToUndefined(this.connectionForm.serverContext),
      serverContextPath: this.emptyToUndefined(this.connectionForm.serverContextPath),
      probeRawOutput: this.rawEmptyToUndefined(this.connectionForm.probeRawOutput),
      probeUpdatedAt: this.emptyToUndefined(this.connectionForm.probeUpdatedAt)
    };
  }

  private parseOptionalPort(value: string | number | null | undefined): number | undefined {
    const trimmed = String(value ?? '').trim();
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

  private withRemoteTerminalSubmitSequence(command: string): string {
    return `${command}\r`;
  }

  private getTerminalSubmitSequence(): string {
    return '\r';
  }

  // Method to copy code to terminal input (adds to prompt for editing, does not execute)
  sendCodeToTerminal(code: string): void {
    const command = this.transformCodeForDisplay(code);
    if (this.activeSessionId && !this.isTerminalSessionWritable(this.activeSessionId)) {
      this.showCopiedNotification('Terminal session ended');
      return;
    }

    if (this.activeSessionId) {
      this.writeToPtySession(this.activeSessionId, command).catch((error) => {
        console.error('Failed to send command to PTY:', error);
      });
    }
    this.focusTerminalInput();

    this.showCopiedNotification('Copied to terminal');
  }

  sendSuggestionToTerminal(suggestion: CommandSuggestion): void {
    if (this.activeSessionId && !this.isTerminalSessionWritable(this.activeSessionId)) {
      this.showCopiedNotification('Terminal session ended');
      return;
    }

    if (this.activeSessionId) {
      this.writeToPtySession(this.activeSessionId, suggestion.command).catch((error) => {
        console.error('Failed to send command to PTY:', error);
      });
    }
    this.focusTerminalInput();

    this.showCopiedNotification('Copied to terminal');
  }

  private createCommandExecutionForSuggestion(
    command: string,
    suggestion?: CommandSuggestion
  ): CommandExecution | undefined {
    if (!suggestion || !this.activeSessionId) {
      return undefined;
    }

    const conversation = this.aiConversationService.getConversation(suggestion.conversationId);
    if (!conversation) {
      console.warn(`Could not find conversation for suggestion ${suggestion.id}.`);
      return undefined;
    }

    const execution = this.aiConversationService.createCommandExecution({
      conversationId: conversation.id,
      suggestionId: suggestion.id,
      terminalSessionId: this.activeSessionId,
      command
    });
    this.syncAiConversationState();

    return execution;
  }

  private markCommandExecutionRunning(execution?: CommandExecution): void {
    if (!execution) {
      return;
    }

    this.aiConversationService.markCommandExecutionRunning(execution.id);
    this.syncAiConversationState();
  }

  private markCommandExecutionFailed(execution?: CommandExecution): void {
    if (!execution) {
      return;
    }

    this.aiConversationService.markCommandExecutionFailed(execution.id);
    this.syncAiConversationState();
  }

  private createRunningExecutionState(
    execution: CommandExecution,
    terminalSessionId: string,
    command: string
  ): RunningExecutionState {
    const markerId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return {
      executionId: execution.id,
      terminalSessionId,
      command,
      wrappedCommand: '',
      markerId,
      startMarker: `__AI_TERMINAL_COMMAND_START_${markerId}__`,
      doneMarker: `__AI_TERMINAL_COMMAND_DONE_${markerId}__`,
      outputBuffer: ''
    };
  }

  // Method to execute code directly
  async executeCodeDirectly(
    code: string,
    options: ExecuteTerminalCommandOptions = {}
  ): Promise<void> {
    const command = options.suggestion ? code.trim() : this.transformCodeForDisplay(code);
    const activeSessionId = this.activeSessionId;
    if (activeSessionId && !this.isTerminalSessionWritable(activeSessionId)) {
      console.warn('Cannot execute command because the terminal session has ended.');
      return;
    }

    if (
      this.executionResultFeatureEnabled &&
      activeSessionId &&
      options.suggestion &&
      this.runningExecutionStatesBySession.has(activeSessionId)
    ) {
      console.warn('A command execution is already running in this terminal session.');
      return;
    }

    const shouldCollectExecution = this.executionResultFeatureEnabled &&
      Boolean(options.suggestion) &&
      this.commandExecutionFormatService.shouldCollectCommandExecution(command);
    const execution = shouldCollectExecution
      ? this.createCommandExecutionForSuggestion(command, options.suggestion)
      : undefined;

    if (activeSessionId) {
      const runningExecution = execution
        ? this.createRunningExecutionState(execution, activeSessionId, command)
        : undefined;
      const commandToExecute = command;
      if (runningExecution) {
        runningExecution.wrappedCommand = commandToExecute;
      }
      const commandWithSubmit = this.withTerminalSubmitSequence(commandToExecute);

      try {
        if (runningExecution) {
          this.runningExecutionStatesBySession.set(activeSessionId, runningExecution);
          this.markCommandExecutionRunning(execution);
        }
        await this.writeToPtySession(activeSessionId, commandWithSubmit);
      } catch (error) {
        if (runningExecution) {
          this.runningExecutionStatesBySession.delete(activeSessionId);
        }
        this.markCommandExecutionFailed(execution);
        console.error('Failed to execute command in PTY:', error);
      }

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

  executeSuggestionDirectly(suggestion: CommandSuggestion): void {
    if (!this.confirmCommandExecutionIfNeeded(suggestion)) {
      return;
    }

    void this.executeCodeDirectly(suggestion.command, { suggestion });
  }

  getCommandRiskLabel(suggestion: CommandSuggestion): string {
    return this.commandRiskPolicyService.getRiskLabel(suggestion.riskLevel);
  }

  getCommandRiskClass(suggestion: CommandSuggestion): string {
    return `risk-${suggestion.riskLevel}`;
  }

  private confirmCommandExecutionIfNeeded(suggestion: CommandSuggestion): boolean {
    if (!this.commandRiskPolicyService.requiresConfirmation(suggestion.riskLevel)) {
      return true;
    }

    const riskLabel = this.getCommandRiskLabel(suggestion);
    return window.confirm([
      `Execute ${riskLabel.toLowerCase()} command "${suggestion.title}"?`,
      '',
      suggestion.command
    ].join('\n'));
  }

  getExecutionsForSuggestion(
    conversation: AiConversation,
    suggestionId: string
  ): CommandExecution[] {
    return conversation.executions.filter((execution) => execution.suggestionId === suggestionId);
  }

  trackByCommandExecutionId(_: number, execution: CommandExecution): string {
    return execution.id;
  }

  getCommandExecutionStatusLabel(execution: CommandExecution): string {
    if (typeof execution.exitCode === 'number') {
      return `${execution.status} (${execution.exitCode})`;
    }

    if (execution.status === 'success') {
      return 'completed';
    }

    return execution.status;
  }

  getCommandExecutionTimeLabel(execution: CommandExecution): string {
    const timestamp = execution.finishedAt || execution.startedAt;
    return new Date(timestamp).toLocaleString();
  }

  getCommandExecutionPreview(execution: CommandExecution): string {
    const output = (execution.editableOutput ?? execution.outputPreview ?? execution.rawOutput).trim();
    if (!output) {
      return execution.status === 'running' ? 'Collecting output...' : '(no output)';
    }

    const lines = output.split('\n');
    const preview = lines.slice(0, 6).join('\n');
    const suffix = lines.length > 6 || preview.length < output.length ? '\n...' : '';
    return `${preview}${suffix}`;
  }

  getCommandExecutionEditableOutput(execution: CommandExecution): string {
    return execution.editableOutput ?? execution.rawOutput;
  }

  toggleCommandExecutionCollapsed(execution: CommandExecution): void {
    const patch: Partial<CommandExecution> = {
      collapsed: !execution.collapsed
    };

    if (execution.collapsed && execution.editableOutput === undefined) {
      patch.editableOutput = execution.rawOutput;
    }

    this.aiConversationService.updateCommandExecution(execution.id, patch);
    this.syncAiConversationState();
  }

  updateCommandExecutionEditableOutput(execution: CommandExecution, value: string): void {
    this.aiConversationService.updateCommandExecution(execution.id, {
      editableOutput: value
    });
    this.syncAiConversationState();
  }

  setCommandExecutionIncludedInContext(execution: CommandExecution, includedInContext: boolean): void {
    this.aiConversationService.updateCommandExecution(execution.id, {
      includedInContext,
      contextMode: includedInContext ? 'full' : 'none'
    });
    this.syncAiConversationState();
  }

  async copyCommandExecutionOutput(execution: CommandExecution): Promise<void> {
    await this.copyToClipboard(this.getCommandExecutionEditableOutput(execution));
    this.showCopiedNotification('Output copied');
  }

  deleteCommandExecution(execution: CommandExecution): void {
    const runningExecution = this.runningExecutionStatesBySession.get(execution.terminalSessionId);
    if (runningExecution?.executionId === execution.id) {
      this.runningExecutionStatesBySession.delete(execution.terminalSessionId);
    }

    this.aiConversationService.removeCommandExecution(execution.id);
    this.syncAiConversationState();
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
    connectionProfileId?: string,
    terminalKind?: TerminalProfileKind,
    wslDistroName?: string
  ): string {
    const { sessions, sessionId, shouldActivate } = this.terminalSessionService.createNewSession(
      this.terminalSessions,
      name,
      setAsActive,
      connectionProfileId,
      terminalKind,
      wslDistroName
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
    if (sessionId === this.activeSessionId) {
      this.scrollSessionTabIntoView(sessionId);
      this.focusTerminalInput();
      return;
    }

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
    this.scrollSessionTabIntoView(sessionId);
    this.syncAiConversationState();

    // Restore session state
    this.restoreSessionState(targetSession);
    if (this.terminal) {
      this.updateTerminalInputMode();
      if (this.isTerminalSessionTerminated(targetSession)) {
        this.renderActivePtyBuffer();
        this.resizeInteractiveTerminal();
        this.focusTerminalInput();
        return;
      }

      void this.ensurePtySession(sessionId).then(() => {
        this.renderActivePtyBuffer();
        this.resizeInteractiveTerminal();
        this.updateTerminalInputMode();
        this.focusTerminalInput();
      }).catch((error) => {
        console.error(`Failed to initialize PTY for ${sessionId}:`, error);
      });
    }
  }

  private scrollSessionTabIntoView(sessionId: string): void {
    requestAnimationFrame(() => {
      const scrollArea = this.tabsScrollAreaRef?.nativeElement;
      if (!scrollArea) {
        return;
      }

      const tab = scrollArea.querySelector<HTMLElement>(
        `[data-session-id="${CSS.escape(sessionId)}"]`
      );
      if (!tab) {
        return;
      }

      const scrollRect = scrollArea.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      let nextScrollLeft = scrollArea.scrollLeft;

      if (tabRect.right > scrollRect.right) {
        nextScrollLeft += tabRect.right - scrollRect.right + 8;
      } else if (tabRect.left < scrollRect.left) {
        nextScrollLeft -= scrollRect.left - tabRect.left + 8;
      }

      const maxScrollLeft = scrollArea.scrollWidth - scrollArea.clientWidth;
      scrollArea.scrollTo({
        left: Math.min(Math.max(nextScrollLeft, 0), maxScrollLeft),
        behavior: 'smooth'
      });
    });
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
      this.ptyRawBufferBySession.delete(sessionId);
      this.ptyDisplayEpochBySession.delete(sessionId);
      this.hiddenConnectionInputEchoesBySession.delete(sessionId);
      this.authPromptReplayFilteredSessions.delete(sessionId);
      this.autoInputReplayValuesBySession.delete(sessionId);
      this.postAutoInputNormalizeBudgetBySession.delete(sessionId);
      this.failRunningExecutionForSession(sessionId);
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

  trackByResponseSegment(index: number, segment: string): string {
    return `${index}-${segment}`;
  }
}
