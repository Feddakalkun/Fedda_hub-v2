// Global ComfyUI Execution Context
// Tracks real-time workflow execution with human-readable node names
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { comfyService } from '../services/comfyService';

type ExecutionState = 'idle' | 'executing' | 'done' | 'error';

interface ExecutionError {
    type: string;
    message: string;
    nodeType?: string;
    nodeId?: string;
}

interface ComfyExecutionContextType {
    state: ExecutionState;
    currentNodeName: string;
    currentNodeId: string | null;
    progress: number; // 0-100
    isDownloaderNode: boolean;
    error: ExecutionError | null;
    totalNodes: number;
    completedNodes: number;
    lastCompletedPromptId: string | null;
    outputReadyCount: number; // increments on each 'executed' event (per output node)
    // Queue a workflow: builds node map, sends to ComfyUI, returns prompt_id
    queueWorkflow: (workflow: Record<string, any>) => Promise<string>;
}

const ComfyExecutionContext = createContext<ComfyExecutionContextType | null>(null);

export const useComfyExecution = () => {
    const ctx = useContext(ComfyExecutionContext);
    if (!ctx) throw new Error('useComfyExecution must be used within ComfyExecutionProvider');
    return ctx;
};

// Regex to detect downloader/model-fetching nodes
const DOWNLOADER_REGEX = /download|linker|fetch|huggingface|hf_hub|model.*load/i;

// Clean up class_type into readable name: "KSampler" -> "KSampler", "CLIPTextEncode" -> "CLIP Text Encode"
function cleanClassName(classType: string): string {
    return classType
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord split
        .replace(/_/g, ' ')
        .trim();
}

// Build a map of nodeId -> human-readable name from workflow JSON
function buildNodeMap(workflow: Record<string, any>): Record<string, { name: string; classType: string }> {
    const map: Record<string, { name: string; classType: string }> = {};
    for (const [nodeId, node] of Object.entries(workflow)) {
        if (!node || typeof node !== 'object') continue;
        const classType = node.class_type || 'Unknown';
        const metaTitle = node._meta?.title;
        const name = metaTitle || cleanClassName(classType);
        map[nodeId] = { name, classType };
    }
    return map;
}

export const ComfyExecutionProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useState<ExecutionState>('idle');
    const [currentNodeName, setCurrentNodeName] = useState('');
    const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [isDownloaderNode, setIsDownloaderNode] = useState(false);
    const [error, setError] = useState<ExecutionError | null>(null);
    const [totalNodes, setTotalNodes] = useState(0);
    const [completedNodes, setCompletedNodes] = useState(0);

    const [lastCompletedPromptId, setLastCompletedPromptId] = useState<string | null>(null);
    const [outputReadyCount, setOutputReadyCount] = useState(0);

    const nodeMapRef = useRef<Record<string, { name: string; classType: string }>>({});
    const executedNodesRef = useRef<Set<string>>(new Set());
    const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activePromptIdRef = useRef<string | null>(null);

    // Connect WebSocket once on mount
    useEffect(() => {
        const disconnect = comfyService.connectWebSocket({
            onExecuting: (nodeId) => {
                // Clear any pending done timer
                if (doneTimerRef.current) {
                    clearTimeout(doneTimerRef.current);
                    doneTimerRef.current = null;
                }

                if (!nodeId) {
                    // null nodeId = workflow finished
                    setState('done');
                    setCurrentNodeName('Complete');
                    setProgress(100);
                    setIsDownloaderNode(false);

                    // Backup: ensure lastCompletedPromptId is set even if 'executed' event was missed
                    // (happens on first run when WebSocket reconnects due to React Strict Mode)
                    if (activePromptIdRef.current) {
                        setLastCompletedPromptId(activePromptIdRef.current);
                    }

                    // Fade to idle after 5s
                    doneTimerRef.current = setTimeout(() => {
                        setState('idle');
                        setCurrentNodeName('');
                        setCurrentNodeId(null);
                        setProgress(0);
                        setCompletedNodes(0);
                        setTotalNodes(0);
                        executedNodesRef.current.clear();
                    }, 5000);
                    return;
                }

                setState('executing');
                setCurrentNodeId(nodeId);
                setError(null);

                // Track completed nodes
                executedNodesRef.current.add(nodeId);
                setCompletedNodes(executedNodesRef.current.size);

                // Look up human-readable name
                const nodeInfo = nodeMapRef.current[nodeId];
                if (nodeInfo) {
                    setCurrentNodeName(nodeInfo.name);
                    setIsDownloaderNode(DOWNLOADER_REGEX.test(nodeInfo.classType) || DOWNLOADER_REGEX.test(nodeInfo.name));
                } else {
                    setCurrentNodeName(`Node ${nodeId}`);
                    setIsDownloaderNode(false);
                }

                // Reset per-node progress
                setProgress(0);
            },

            onProgress: (_node, value, max) => {
                setProgress(Math.round((value / max) * 100));
            },

            onCompleted: (promptId) => {
                activePromptIdRef.current = promptId;
                setLastCompletedPromptId(promptId);
                setOutputReadyCount(prev => prev + 1);
            },

            onStatus: (data) => {
                // Check for errors in status messages
                if (data?.exec_info?.queue_remaining === 0 && state === 'executing') {
                    // Queue empty while we were executing - might have errored
                }
            },
        });

        return () => disconnect();
    }, []);

    // Queue workflow with node map building
    const queueWorkflow = useCallback(async (workflow: Record<string, any>): Promise<string> => {
        // Build node map from workflow
        const nodeMap = buildNodeMap(workflow);
        nodeMapRef.current = nodeMap;
        setTotalNodes(Object.keys(nodeMap).length);
        executedNodesRef.current.clear();
        setCompletedNodes(0);
        setOutputReadyCount(0);

        // Reset state
        setState('executing');
        setCurrentNodeName('Queuing...');
        setCurrentNodeId(null);
        setProgress(0);
        setError(null);
        setIsDownloaderNode(false);

        try {
            const result = await comfyService.queuePrompt(workflow);
            activePromptIdRef.current = result.prompt_id;
            return result.prompt_id;
        } catch (err: any) {
            // Parse ComfyUI error response
            let execError: ExecutionError = {
                type: 'queue_error',
                message: err.message || 'Failed to queue workflow',
            };

            // Try to extract specific node error from ComfyUI response
            try {
                if (err.message?.includes('missing_node_type')) {
                    const match = err.message.match(/Node '(.+?)' not found/);
                    execError = {
                        type: 'missing_node_type',
                        message: match ? `Missing node: "${match[1]}"` : 'Missing custom node',
                        nodeType: match?.[1],
                    };
                }
            } catch {}

            setState('error');
            setError(execError);
            setCurrentNodeName('Error');
            throw err;
        }
    }, []);

    return (
        <ComfyExecutionContext.Provider value={{
            state,
            currentNodeName,
            currentNodeId,
            progress,
            isDownloaderNode,
            error,
            totalNodes,
            completedNodes,
            lastCompletedPromptId,
            outputReadyCount,
            queueWorkflow,
        }}>
            {children}
        </ComfyExecutionContext.Provider>
    );
};
