export interface GoogleCredentialResponse {
  credential?: string;
}

export interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce: string;
    auto_select: false;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      text: "continue_with";
      shape: "rectangular";
      locale: "ko";
      width: number;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let loading: Promise<GoogleIdentity> | null = null;

// Load only after an explicit action. All mounted consumers share one script;
// failed/blocked loads can be retried without leaving a rejected singleton.
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const available = window.google?.accounts?.id;
  if (available) return Promise.resolve(available);
  if (loading) return loading;

  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    const timer = window.setTimeout(() => fail(), 15_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };
    const fail = () => {
      cleanup();
      script.remove();
      loading = null;
      reject(
        new Error(
          "Google 로그인 화면을 불러오지 못했습니다. 네트워크나 브라우저 차단 설정을 확인한 뒤 다시 시도해 주세요.",
        ),
      );
    };
    script.onerror = fail;
    script.onload = () => {
      const identity = window.google?.accounts?.id;
      if (!identity) return fail();
      cleanup();
      resolve(identity);
    };
    document.head.appendChild(script);
  });
  return loading;
}
