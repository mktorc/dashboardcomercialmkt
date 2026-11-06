import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VAPID_PUBLIC_KEY } from "@/lib/push-config";

const toKey = (base64: string) => {
  const raw = atob(
    base64
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(base64.length / 4) * 4, "="),
  );
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

/** Liga/desliga as notificações de "sinal pago" neste aparelho (sem login). */
export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok)
      currentSubscription()
        .then(({ sub }) => setOn(!!sub && Notification.permission === "granted"))
        .catch(() => {});
  }, []);

  const enable = async () => {
    if (isIos() && !isStandalone()) {
      toast.info(
        "No iPhone, instale o app primeiro: Compartilhar → Adicionar à Tela de Início. Depois ative aqui.",
      );
      return;
    }
    if (!supported) {
      toast.error("Este navegador não suporta notificações.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error("Permissão de notificação negada. Libere nas configurações do navegador.");
      return;
    }
    const { reg, sub: existing } = await currentSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toKey(VAPID_PUBLIC_KEY),
      }));
    const json = sub.toJSON();
    const res = await fetch("/api/public/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!res.ok) throw new Error("Falha ao registrar o aparelho");
    setOn(true);
    toast.success("Notificações ativadas neste aparelho.");
  };

  const disable = async () => {
    const { sub } = await currentSubscription();
    if (sub) {
      await fetch("/api/public/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
    setOn(false);
    toast.success("Notificações desativadas neste aparelho.");
  };

  const toggle = async () => {
    setBusy(true);
    try {
      await (on ? disable() : enable());
    } catch (e) {
      toast.error((e as Error).message || "Não foi possível alterar as notificações.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={busy}
      title="Avisa quando uma reserva tiver o sinal pago (pending → open)"
    >
      {on ? <Bell className="mr-1 size-4" /> : <BellOff className="mr-1 size-4" />}
      {on ? "Notificações ativas" : "Ativar notificações"}
    </Button>
  );
}
