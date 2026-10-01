import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT, CHAT_MAX_LEN, CHAT_SEND_COOLDOWN_MS, MULTIPLAYER } from '../config/balance';
import { ChatStore, type ChatMessage } from '../chat/ChatStore';
import {
  applyMobileInputAttributes,
  chatSendState,
  colorNumberToCss,
  formatChatLine,
  isolateChatInput,
  MOBILE_INPUT_PRESETS,
  SELF_LABEL,
  visibleChatMessages,
  type GlobalCaptureKeyboard,
} from '../ui/ChatPanel';

/**
 * Tests de la lógica de presentación del ChatPanel (C1) y del AISLAMIENTO de
 * foco del input DOM. El panel como objeto Phaser (render, botones, DOM
 * element) no es testeable en happy-dom; todo lo DECISIVO se extrajo como
 * funciones puras o como `isolateChatInput`, que sí corren acá con eventos
 * DOM reales de happy-dom (incluida la propagación a window, que es justo lo
 * que hay que cortar para que Phaser no reciba las teclas).
 */

const SELF_COLOR = CHAT.selfColor;

/** Un mensaje con defaults sensatos (solo lo que la línea consume). */
function message(partial: Partial<ChatMessage>): ChatMessage {
  return {
    threadId: 'room',
    fromPeerId: 'aa-ana',
    fromName: 'Ana',
    color: 0xd63c3c,
    text: 'hola',
    at: 1_000,
    mine: false,
    ...partial,
  };
}

describe('ChatPanel — colorNumberToCss', () => {
  it('convierte 0xrrggbb a CSS con padding', () => {
    expect(colorNumberToCss(0xd63c3c)).toBe('#d63c3c');
    expect(colorNumberToCss(0x0c0c14)).toBe('#0c0c14');
    expect(colorNumberToCss(0)).toBe('#000000');
  });

  it('degrada colores inválidos al blanco hueso (nunca lanza)', () => {
    expect(colorNumberToCss(Number.NaN)).toBe('#f2f2f2');
    expect(colorNumberToCss(-1)).toBe('#f2f2f2');
  });
});

describe('ChatPanel — formatChatLine ("NOMBRE: texto")', () => {
  it('mensaje ajeno: "Ana: hola" coloreado con el color del peer', () => {
    const line = formatChatLine(message({}));
    expect(line).toEqual({ text: 'Ana: hola', color: '#d63c3c', mine: false });
  });

  it('mensaje propio: "VOS: hola", color destacado y flag mine', () => {
    const line = formatChatLine(
      message({ mine: true, fromName: 'Yo', color: 0x3c6cd6 }),
    );
    expect(line).toEqual({ text: `${SELF_LABEL}: hola`, color: SELF_COLOR, mine: true });
    expect(SELF_LABEL).toBe('VOS');
  });

  it('remitente sin nombre → "PILOTO: texto"', () => {
    const line = formatChatLine(message({ fromName: '' }));
    expect(line.text).toBe('PILOTO: hola');
  });
});

describe('ChatPanel — visibleChatMessages (orden y límite)', () => {
  const messages = ['uno', 'dos', 'tres', 'cuatro', 'cinco'].map((text, index) =>
    message({ text, at: index }),
  );

  it('mantiene el orden de llegada y recorta los MÁS VIEJOS al tope', () => {
    const visible = visibleChatMessages(messages, 3);
    expect(visible.map((m) => m.text)).toEqual(['tres', 'cuatro', 'cinco']);
  });

  it('con menos mensajes que el tope los devuelve todos, en orden', () => {
    expect(visibleChatMessages(messages.slice(0, 2), 10).map((m) => m.text)).toEqual(['uno', 'dos']);
    expect(visibleChatMessages([], 10)).toEqual([]);
  });

  it('tope no positivo no muestra nada', () => {
    expect(visibleChatMessages(messages, 0)).toEqual([]);
  });

  it('CHAT.visibleMessages es el tope del panel (los últimos visibles)', () => {
    expect(CHAT.visibleMessages).toBeGreaterThan(0);
    const many = Array.from({ length: CHAT.visibleMessages + 10 }, (_, i) => message({ text: `m${i}` }));
    expect(visibleChatMessages(many, CHAT.visibleMessages)).toHaveLength(CHAT.visibleMessages);
  });
});

describe('ChatPanel — chatSendState (botón ENVIAR según cooldown)', () => {
  it('sin cooldown: ENVIAR habilitado', () => {
    expect(chatSendState(0)).toEqual({ label: 'ENVIAR', disabled: false });
  });

  it('en cooldown: "ESPERÁ…" y deshabilitado (visible para el usuario)', () => {
    expect(chatSendState(1)).toEqual({ label: 'ESPERÁ…', disabled: true });
    expect(chatSendState(CHAT_SEND_COOLDOWN_MS)).toEqual({ label: 'ESPERÁ…', disabled: true });
  });

  it('es coherente con el cooldown real del store', () => {
    const store = new ChatStore({ self: { peerId: 'me', name: 'Yo', color: 0 } });
    store.sendRoomMessage('hola', 1_000);
    expect(chatSendState(store.cooldownRemainingMs('room', 1_000)).disabled).toBe(true);
    expect(chatSendState(store.cooldownRemainingMs('room', 1_000 + CHAT_SEND_COOLDOWN_MS)).disabled).toBe(false);
  });
});

describe('ChatPanel — applyMobileInputAttributes (teclado virtual que ayuda)', () => {
  /** Input DOM real de happy-dom (los atributos se reflejan como en el navegador). */
  function mountInput(): HTMLInputElement {
    const node = document.createElement('input');
    document.body.appendChild(node);
    return node;
  }

  it('chat: máx 200, Enter=ENVIAR, SIN mayúsculas forzadas, sin autocompletar', () => {
    const node = mountInput();
    applyMobileInputAttributes(node, 'chat');

    expect(node.maxLength).toBe(CHAT_MAX_LEN);
    expect(node.getAttribute('enterkeyhint')).toBe('send');
    expect(node.autocapitalize).toBe('none');
    expect(node.autocomplete).toBe('off');
    expect(node.getAttribute('inputmode')).toBe('text');
    node.remove();
  });

  it('nombre: máx 12 (el tope del protocolo) y Enter=LISTO', () => {
    const node = mountInput();
    applyMobileInputAttributes(node, 'name');

    expect(node.maxLength).toBe(MULTIPLAYER.maxPlayerNameLength);
    expect(node.getAttribute('enterkeyhint')).toBe('done');
    expect(node.autocapitalize).toBe('words');
    node.remove();
  });

  it('palabra de sala: máx 9, Enter=IR (ENTRAR) y TODO en mayúsculas', () => {
    const node = mountInput();
    applyMobileInputAttributes(node, 'roomWord');

    expect(node.maxLength).toBe(MULTIPLAYER.roomWordMaxLength);
    expect(node.getAttribute('enterkeyhint')).toBe('go');
    expect(node.autocapitalize).toBe('characters'); // el dominio es A–Z
    node.remove();
  });

  it('todos los presets apagan el autocorrect del teclado (Webkit)', () => {
    for (const kind of ['chat', 'name', 'roomWord'] as const) {
      const node = mountInput();
      applyMobileInputAttributes(node, kind);
      expect(node.getAttribute('autocorrect')).toBe('off');
      expect(node.getAttribute('spellcheck')).toBe('false');
      node.remove();
    }
  });

  it('los presets declaran el largo del dominio que el sanitize recorta', () => {
    // Coherencia con las constantes del protocolo: si alguien cambia un tope
    // en balance.ts, el input DOM lo sigue sin editar este test.
    expect(MOBILE_INPUT_PRESETS.chat.maxLength).toBe(CHAT_MAX_LEN);
    expect(MOBILE_INPUT_PRESETS.name.maxLength).toBe(MULTIPLAYER.maxPlayerNameLength);
    expect(MOBILE_INPUT_PRESETS.roomWord.maxLength).toBe(MULTIPLAYER.roomWordMaxLength);
  });
});

describe('ChatPanel — isolateChatInput (foco aislado del juego)', () => {
  /** Teclado falso de Phaser: espía las dos palancas de captura global. */
  function fakeKeyboard(): GlobalCaptureKeyboard & {
    disabled: ReturnType<typeof vi.fn>;
    enabled: ReturnType<typeof vi.fn>;
  } {
    const disabled = vi.fn();
    const enabled = vi.fn();
    return {
      disabled,
      enabled,
      disableGlobalCapture: disabled,
      enableGlobalCapture: enabled,
    };
  }

  /** Dispacha keydown en el nodo (burbujea a window como en el navegador). */
  function pressKey(node: HTMLElement, key: string): void {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  let cleanup: HTMLElement[] = [];

  afterEach(() => {
    for (const node of cleanup) {
      node.remove();
    }
    cleanup = [];
  });

  function mountInput(): HTMLInputElement {
    const node = document.createElement('input');
    document.body.appendChild(node);
    cleanup.push(node);
    return node;
  }

  it('lo tipeado NO llega a window: Phaser (que escucha ahí) no recibe las teclas', () => {
    const node = mountInput();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const isolation = isolateChatInput(node, null, () => {});

    pressKey(node, 'p');
    pressKey(node, ' ');
    pressKey(node, 'ArrowLeft');
    expect(onWindowKey).not.toHaveBeenCalled();

    window.removeEventListener('keydown', onWindowKey);
    isolation.detach();
  });

  it('Enter envía (atajo) SIN que la tecla escape al juego', () => {
    const node = mountInput();
    const onSubmit = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const isolation = isolateChatInput(node, null, onSubmit);

    pressKey(node, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onWindowKey).not.toHaveBeenCalled();

    window.removeEventListener('keydown', onWindowKey);
    isolation.detach();
  });

  it('Escape cancela (cierra el overlay) sin propagarse', () => {
    const node = mountInput();
    const onCancel = vi.fn();
    const isolation = isolateChatInput(node, null, () => {}, onCancel);

    pressKey(node, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);

    isolation.detach();
  });

  it('focus/blur apagan y restauran la captura global de Phaser', () => {
    const node = mountInput();
    const keyboard = fakeKeyboard();
    const isolation = isolateChatInput(node, keyboard, () => {});

    node.dispatchEvent(new Event('focus'));
    expect(keyboard.disabled).toHaveBeenCalledTimes(1);
    expect(keyboard.enabled).not.toHaveBeenCalled();

    node.dispatchEvent(new Event('blur'));
    expect(keyboard.enabled).toHaveBeenCalledTimes(1);

    isolation.detach();
  });

  it('detach restaura TODO: propagación y captura (el juego vuelve a capturar)', () => {
    const node = mountInput();
    const keyboard = fakeKeyboard();
    const onSubmit = vi.fn();
    const isolation = isolateChatInput(node, keyboard, onSubmit);

    node.dispatchEvent(new Event('focus')); // captura apagada
    isolation.detach();
    // La captura quedó restaurada aunque el blur nunca disparó…
    expect(keyboard.enabled).toHaveBeenCalled();
    // …y las teclas vuelven a llegar a window (Phaser recibe de nuevo).
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    pressKey(node, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onWindowKey).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', onWindowKey);
  });

  it('funciona sin teclado de Phaser (keyboard null: solo aísla la propagación)', () => {
    const node = mountInput();
    const isolation = isolateChatInput(node, null, () => {});
    node.dispatchEvent(new Event('focus'));
    expect(() => isolation.detach()).not.toThrow();
  });
});
