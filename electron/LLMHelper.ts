import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import OpenAI from "openai"
import fs from "fs"
import os from "os"

export type CloudProvider = "gemini" | "openai"

export const DEFAULT_SYSTEM_PROMPT = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`

interface OllamaResponse {
  response: string
  done: boolean
}

export class LLMHelper {
  private model: GenerativeModel | null = null
  private openaiClient: OpenAI | null = null
  private openaiModel: string = "gpt-4o"
  private cloudProvider: CloudProvider = "gemini"
  private systemPrompt: string = DEFAULT_SYSTEM_PROMPT
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"

  constructor(
    apiKey?: string,
    useOllama: boolean = false,
    ollamaModel?: string,
    ollamaUrl?: string,
    cloudProvider: CloudProvider = "gemini"
  ) {
    this.useOllama = useOllama
    this.cloudProvider = cloudProvider

    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      this.initializeOllamaModel()
    } else if (apiKey) {
      if (cloudProvider === "openai") {
        this.openaiClient = new OpenAI({ apiKey })
        this.cloudProvider = "openai"
        console.log("[LLMHelper] Using OpenAI")
      } else {
        const genAI = new GoogleGenerativeAI(apiKey)
        this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
        this.cloudProvider = "gemini"
        console.log("[LLMHelper] Using Google Gemini")
      }
    } else {
      throw new Error("Either provide Gemini/OpenAI API key or enable Ollama mode")
    }
  }

  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOpenAI(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
    if (!this.openaiClient) throw new Error("OpenAI client not configured")
    const completion = await this.openaiClient.chat.completions.create({
      model: this.openaiModel,
      messages: [{ role: "system", content: this.systemPrompt }, ...messages],
      temperature: 0.7,
    })
    const text = completion.choices[0]?.message?.content
    if (text == null) throw new Error("Empty response from OpenAI")
    return text
  }

  private async callCloud(prompt: string): Promise<string> {
    if (this.cloudProvider === "openai" && this.openaiClient) {
      return this.callOpenAI([{ role: "user", content: prompt }])
    }
    if (this.model) {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text()
    }
    throw new Error("No cloud LLM configured")
  }

  private async callCloudWithImages(prompt: string, imagePaths: string[]): Promise<string> {
    if (this.cloudProvider === "openai" && this.openaiClient) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: "text", text: prompt }]
      for (const path of imagePaths) {
        const data = await fs.promises.readFile(path)
        const b64 = data.toString("base64")
        content.push({
          type: "image_url",
          image_url: { url: `data:image/png;base64,${b64}` },
        })
      }
      return this.callOpenAI([{ role: "user", content }])
    }
    if (this.model) {
      const imageParts = await Promise.all(imagePaths.map((p) => this.fileToGenerativePart(p)))
      const result = await this.model.generateContent([prompt, ...imageParts])
      const response = await result.response
      return response.text()
    }
    throw new Error("No cloud LLM configured")
  }

  private async callCloudWithImage(prompt: string, imageBase64: string, mimeType: string): Promise<string> {
    if (this.cloudProvider === "openai" && this.openaiClient) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      ]
      return this.callOpenAI([{ role: "user", content }])
    }
    if (this.model) {
      const imagePart = { inlineData: { data: imageBase64, mimeType } }
      const result = await this.model.generateContent([prompt, imagePart])
      const response = await result.response
      return response.text()
    }
    throw new Error("No cloud LLM configured")
  }

  private async callCloudWithAudio(prompt: string, audioBase64: string, mimeType: string): Promise<string> {
    if (this.cloudProvider === "openai" && this.openaiClient) {
      const ext = mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3" : "wav"
      const tmpPath = `${os.tmpdir()}/wingman-audio-${Date.now()}.${ext}`
      await fs.promises.writeFile(tmpPath, Buffer.from(audioBase64, "base64"))
      try {
        const transcription = await this.openaiClient.audio.transcriptions.create({
          file: fs.createReadStream(tmpPath) as any,
          model: "whisper-1",
        })
        const transcript = (transcription as any).text ?? ""
        const fullReply = await this.callOpenAI([
          { role: "user", content: `${prompt}\n\nTranscription of the audio:\n${transcript}` },
        ])
        return fullReply
      } finally {
        await fs.promises.unlink(tmpPath).catch(() => {})
      }
    }
    if (this.model) {
      const audioPart = { inlineData: { data: audioBase64, mimeType } }
      const result = await this.model.generateContent([prompt, audioPart])
      const response = await result.response
      return response.text()
    }
    throw new Error("No cloud LLM configured")
  }

  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      const testResult = await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`
      const text = await this.callCloudWithImages(prompt, imagePaths)
      return JSON.parse(this.cleanJsonResponse(text))
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`
    console.log("[LLMHelper] Calling cloud LLM for solution...")
    try {
      const text = await this.callCloud(prompt)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error)
      throw error
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`
      const text = await this.callCloudWithImages(prompt, debugImagePaths)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      const audioData = await fs.promises.readFile(audioPath)
      const mimeType = audioPath.endsWith(".wav") ? "audio/wav" : "audio/mp3"
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`
      const text = await this.callCloudWithAudio(prompt, audioData.toString("base64"), mimeType)
      return { text, timestamp: Date.now() }
    } catch (error) {
      console.error("Error analyzing audio file:", error)
      throw error
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user and be concise.`
      const text = await this.callCloudWithAudio(prompt, data, mimeType)
      return { text, timestamp: Date.now() }
    } catch (error) {
      console.error("Error analyzing audio from base64:", error)
      throw error
    }
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const imageData = await fs.promises.readFile(imagePath)
      const mimeType = "image/png"
      const prompt = `${this.systemPrompt}\n\nDescribe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user. Be concise and brief.`
      const text = await this.callCloudWithImage(prompt, imageData.toString("base64"), mimeType)
      return { text, timestamp: Date.now() }
    } catch (error) {
      console.error("Error analyzing image file:", error)
      throw error
    }
  }

  public getSystemPrompt(): string {
    return this.systemPrompt
  }

  public setSystemPrompt(text: string): void {
    const t = text.trim()
    this.systemPrompt = t.length > 0 ? t : DEFAULT_SYSTEM_PROMPT
  }

  public resetSystemPromptToDefault(): void {
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT
  }

  public isDefaultSystemPrompt(): boolean {
    return this.systemPrompt === DEFAULT_SYSTEM_PROMPT
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.useOllama) return this.callOllama(`${this.systemPrompt}\n\n${message}`)
      if (this.cloudProvider === "openai" && this.openaiClient) {
        return this.callOpenAI([{ role: "user", content: message }])
      }
      if (this.model) {
        const result = await this.model.generateContent(`${this.systemPrompt}\n\n${message}`)
        const response = await result.response
        return response.text()
      }
      throw new Error("No LLM provider configured")
    } catch (error) {
      console.error("[LLMHelper] Error in chat:", error)
      throw error
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" | "openai" {
    if (this.useOllama) return "ollama"
    return this.cloudProvider
  }

  public getCurrentModel(): string {
    if (this.useOllama) return this.ollamaModel
    return this.cloudProvider === "openai" ? this.openaiModel : "gemini-2.0-flash"
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
      this.openaiClient = null
    }
    if (!this.model && !apiKey) throw new Error("No Gemini API key provided and no existing model instance")
    this.useOllama = false
    this.cloudProvider = "gemini"
    console.log("[LLMHelper] Switched to Gemini")
  }

  public async switchToOpenAI(apiKey?: string, model?: string): Promise<void> {
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey })
      this.openaiModel = model || "gpt-4o"
      this.model = null
    }
    if (!this.openaiClient && !apiKey) throw new Error("No OpenAI API key provided and no existing client")
    this.useOllama = false
    this.cloudProvider = "openai"
    console.log("[LLMHelper] Switched to OpenAI")
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable()
        if (!available) return { success: false, error: `Ollama not available at ${this.ollamaUrl}` }
        await this.callOllama("Hello")
        return { success: true }
      }
      const text = await this.callCloud("Hello")
      return text ? { success: true } : { success: false, error: "Empty response from cloud LLM" }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }
} 