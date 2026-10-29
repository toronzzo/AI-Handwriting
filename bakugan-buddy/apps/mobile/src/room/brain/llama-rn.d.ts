/** Minimal surface. The real package is installed only for a dev-client build. */
declare module "llama.rn" {
  export type LlamaContext = {
    completion(params: {
      messages: { role: string; content: string }[];
      n_predict: number;
      temperature: number;
    }): Promise<{ text: string }>;
    release(): Promise<void>;
  };
  export function initLlama(params: { model: string; n_ctx: number; n_gpu_layers: number }): Promise<LlamaContext>;
}
