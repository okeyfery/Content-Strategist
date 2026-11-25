import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'خطای غیرمنتظره‌ای در برنامه رخ داد.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string; path?: string };
      if (parsed?.error) {
        if (parsed.error.includes('Quota exceeded')) {
          message =
            'سهمیه روزانه رایگان پایگاه داده Firestore تکمیل شده است. فردا مجدداً بازنشانی می‌شود یا می‌توانید پلن پروژه را ارتقا دهید.';
        } else if (parsed.error.includes('permission') || parsed.error.includes('insufficient')) {
          message = `خطای دسترسی به داده (${parsed.operationType || 'عملیات'} در ${parsed.path || 'مسیر'}). لطفاً از ورود معتبر با حساب گوگل اطمینان حاصل کنید.`;
        } else {
          message = parsed.error;
        }
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#0B0F17] text-[#F1F5F9] flex items-center justify-center p-6"
        >
          <div className="max-w-lg w-full bg-[#111827] border border-[#1F2937] rounded-xl p-8 space-y-5">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold text-white">خطا در ارتباط یا پردازش داده‌ها</h1>
            </div>
            <p className="text-sm leading-relaxed text-[#94A3B8]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              بارگذاری مجدد برنامه
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
