
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { WordDetail } from "../types";

// Always use process.env.API_KEY directly.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const extractTextFromImage = async (base64Image: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: 'image/png', data: base64Image } },
        { text: "Extract the English text from this image. Only provide the text itself, no explanations." }
      ]
    }
  });
  return response.text?.trim() || "No text found.";
};

export const analyzeWord = async (word: string, context: string): Promise<WordDetail> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze the English word "${word}" in the context of: "${context}". 
    Provide definitions and examples in BOTH English and Chinese (Simplified).
    Return the result in JSON format matching the schema.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          phonetic: { type: Type.STRING },
          definitions: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                en: { type: Type.STRING }, 
                zh: { type: Type.STRING } 
              },
              required: ["en", "zh"]
            } 
          },
          examples: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                en: { type: Type.STRING }, 
                zh: { type: Type.STRING } 
              },
              required: ["en", "zh"]
            } 
          },
        },
        required: ["word", "phonetic", "definitions", "examples"]
      }
    }
  });
  
  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    throw new Error("Failed to parse word analysis");
  }
};

export const evaluatePronunciation = async (audioBase64: string, targetText: string): Promise<{ score: number; feedback: string; transcription: string; corrections: string[] }> => {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    contents: [
      {
        inlineData: {
          mimeType: 'audio/webm',
          data: audioBase64
        }
      },
      {
        text: `Evaluate the user's pronunciation in the audio. They are trying to say: "${targetText}". 
        Provide:
        1. A score from 0-100.
        2. Specific feedback in Chinese.
        3. A verbatim transcription of what the user actually said (including errors).
        4. A list of specific words from the transcription that were mispronounced or used incorrectly.
        Return strictly in JSON format.`
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          transcription: { type: Type.STRING },
          corrections: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["score", "feedback", "transcription", "corrections"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    throw new Error("Failed to evaluate pronunciation");
  }
};

export const evaluatePracticeSentence = async (word: string, sentence: string): Promise<{ isCorrect: boolean; feedback: string; suggestion: string }> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `The user is practicing the word "${word}". 
    They wrote the following sentence: "${sentence}".
    Evaluate if the word is used correctly. 
    Provide feedback in Chinese and suggest a better version if necessary.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isCorrect: { type: Type.BOOLEAN },
          feedback: { type: Type.STRING },
          suggestion: { type: Type.STRING }
        },
        required: ["isCorrect", "feedback", "suggestion"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    throw new Error("Failed to evaluate sentence");
  }
};

export const compareTranslations = async (original: string, user: string): Promise<{ aiTranslation: string, comparison: string }> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Original English: "${original}"
User's Translation: "${user}"

Please provide:
1. A highly accurate Chinese translation.
2. A professional comparison of the user's attempt versus the accurate translation, highlighting subtle nuances and grammatical points.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          aiTranslation: { type: Type.STRING },
          comparison: { type: Type.STRING },
        },
        required: ["aiTranslation", "comparison"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}');
  } catch (e) {
    throw new Error("Failed to compare translations");
  }
};

export const generateSpeech = async (text: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this English text naturally: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};
