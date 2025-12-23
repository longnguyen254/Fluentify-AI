
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult, Difficulty } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeSpeech = async (
  targetText: string,
  audioBase64: string,
  difficulty: Difficulty = 'Medium'
): Promise<AnalysisResult> => {
  const difficultyPrompt = {
    Easy: "CHẾ ĐỘ DỄ: Hãy rộng lượng. Tập trung vào việc khuyến khích. Chỉ ra những từ phát âm sai hoàn toàn. Bỏ qua các lỗi nhỏ về âm đuôi hoặc trọng âm nhẹ. Điểm số cao nếu người dùng nói trôi chảy.",
    Medium: "CHẾ ĐỘ TRUNG BÌNH: Đánh giá tiêu chuẩn. Yêu cầu đúng các âm cơ bản và trọng âm từ. Nhận xét cân bằng giữa khen ngợi và chỉ lỗi.",
    Hard: "CHẾ ĐỘ KHÓ (CHUYÊN GIA): CỰC KỲ KHẮT KHE. Soi kỹ từng âm cuối (/s/, /t/, /d/), các nguyên âm đôi, nối âm và ngữ điệu. Chỉ cần 1 lỗi nhỏ điểm phải dưới 80. Nhận xét thẳng thắn và chuyên sâu."
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        parts: [
          {
            text: `PHONETIC ANALYSIS TASK:
            Target Text: "${targetText}"
            Current Difficulty Level: ${difficulty}
            
            Instruction: ${difficultyPrompt[difficulty]}
            
            Required Output Format (ALL EXPLANATIONS MUST BE IN VIETNAMESE):
            - feedback: Sử dụng dấu gạch đầu dòng (-) cho từng lỗi phát âm cụ thể hoặc quan sát về âm thanh. BẮT BUỘC xuống dòng sau mỗi gạch đầu dòng.
            - tips: Sử dụng dấu gạch đầu dòng (-) cho các lời khuyên thực tế. BẮT BUỘC xuống dòng sau mỗi gạch đầu dòng.
            - transcription: Ghi lại CHÍNH XÁC những gì bạn nghe thấy.
            - accuracyScore: 0-100 (Dựa trên mức độ khó đã chọn).
            - mispronouncedWords: Danh sách các từ người dùng phát âm sai.`
          },
          {
            inlineData: {
              mimeType: 'audio/webm',
              data: audioBase64
            }
          }
        ]
      }
    ],
    config: {
      systemInstruction: "Bạn là một huấn luyện viên phát âm tiếng Anh chuyên nghiệp. Bạn điều chỉnh phong cách chấm điểm dựa trên độ khó được yêu cầu. Luôn phản hồi bằng TIẾNG VIỆT. Đảm bảo các gạch đầu dòng được phân tách bằng ký tự xuống dòng (\\n).",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          accuracyScore: { type: Type.NUMBER },
          transcription: { type: Type.STRING },
          mispronouncedWords: { 
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          feedback: { type: Type.STRING },
          tips: { type: Type.STRING },
          isPerfect: { type: Type.BOOLEAN }
        },
        required: ["accuracyScore", "transcription", "mispronouncedWords", "feedback", "tips", "isPerfect"]
      }
    }
  });

  return JSON.parse(response.text || '{}') as AnalysisResult;
};

export const textToSpeech = async (text: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio data received");
  return base64Audio;
};

export const generatePracticePhrase = async (): Promise<string> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: 'Generate a single, interesting English sentence for pronunciation practice. Return ONLY the sentence text.',
  });
  return response.text?.trim() || "The quick brown fox jumps over the lazy dog.";
};
