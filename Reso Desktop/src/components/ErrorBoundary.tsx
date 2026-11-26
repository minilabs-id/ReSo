import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    copied: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, copied: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private copyTimer?: number;

  public componentWillUnmount() {
    window.clearTimeout(this.copyTimer);
  }

  private getDetailText = (): string => {
    const error = this.state.error;
    if (!error) return '';
    return [error.message, error.stack].filter(Boolean).join('\n\n');
  };

  private handleCopy = async () => {
    const detail = this.getDetailText();
    if (!detail) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(detail);
      } else {
        throw new Error('Clipboard API tidak tersedia');
      }
    } catch {
      // Fallback untuk konteks tanpa Clipboard API (mis. webview / HTTP lama).
      const textarea = document.createElement('textarea');
      textarea.value = detail;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        // Abaikan — pengguna masih bisa menyalin manual dari blok detail.
      }
      document.body.removeChild(textarea);
    }

    this.setState({ copied: true });
    window.clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => this.setState({ copied: false }), 2000);
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center bg-slate-50/50 rounded-xl border border-slate-200 m-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Terjadi Kesalahan</h2>
          <p role="alert" className="text-sm text-slate-500 mb-6 max-w-md">
            Sistem mendapati kesalahan saat memuat tampilan ini. Cobalah untuk memuat ulang halaman.
          </p>
          <Button 
            onClick={() => window.location.reload()}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold"
          >
            <RefreshCcw className="w-4 h-4 mr-2" />
            Muat Ulang
          </Button>
          <details className="mt-6 w-full max-w-md text-left">
            <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-800 select-none">
              Detail teknis
            </summary>
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] font-mono text-slate-600">
                {this.getDetailText() || 'Detail tidak tersedia.'}
              </pre>
              <Button
                type="button"
                variant="outline"
                onClick={this.handleCopy}
                className="mt-3 h-8 rounded-xl border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                {this.state.copied ? 'Tersalin' : 'Salin detail'}
              </Button>
            </div>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
