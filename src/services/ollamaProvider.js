const env = require('../config/env');
const { ErrorAplicacion } = require('../errors/ErrorAplicacion');

const errores = {
  SERVICIO_IA_NO_CONFIGURADO: ['Configura el modelo de NutriVida AI. Las demás funciones siguen disponibles.', 503],
  OLLAMA_NO_DISPONIBLE: ['El servicio local NutriVida AI no está disponible temporalmente.', 503],
  TIMEOUT: ['El servicio de IA tardó demasiado en responder.', 504],
  MODELO_OLLAMA_NO_ENCONTRADO: ['El modelo configurado no está disponible en Ollama.', 503],
  ERROR_RESPUESTA_OLLAMA: ['Ollama no pudo procesar la solicitud.', 503],
  LIMITE_USO: ['El servicio de IA alcanzó su límite de uso.', 429],
  RESPUESTA_IA_VACIA: ['El servicio de IA devolvió una respuesta vacía.', 502],
  RESPUESTA_INVALIDA: ['El servicio de IA devolvió una respuesta en un formato inesperado.', 502],
  FALLA_SERVICIO: ['El servicio de IA no pudo procesar la solicitud.', 503]
};
function errorIA(codigo) {
  const [mensaje, status] = errores[codigo] || errores.FALLA_SERVICIO;
  return new ErrorAplicacion(mensaje, status, errores[codigo] ? codigo : 'FALLA_SERVICIO');
}

class OllamaProvider {
  constructor({ baseUrl = env.ollamaBaseUrl, model = env.ollamaModel,
    timeoutMs = env.ollamaTimeoutMs, transporte = (...args) => fetch(...args) } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model.trim(); this.timeoutMs = timeoutMs; this.transporte = transporte;
  }
  // El límite cubre conexión y cuerpo completo, incluso en transportes que ignoran abort.
  async solicitar(ruta, opciones = {}, timeoutMs = this.timeoutMs) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => {
          const res = await this.transporte(this.baseUrl + ruta, { ...opciones, signal: controller.signal });
          if (!res.ok) throw errorIA(res.status === 404 ? 'MODELO_OLLAMA_NO_ENCONTRADO'
            : res.status === 429 ? 'LIMITE_USO' : 'ERROR_RESPUESTA_OLLAMA');
          try { return await res.json(); }
          catch { throw errorIA('RESPUESTA_INVALIDA'); }
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          reject(errorIA('TIMEOUT')); controller.abort();
        }, timeoutMs); })
      ]);
    } catch (err) {
      if (err instanceof ErrorAplicacion) throw err;
      throw errorIA(controller.signal.aborted ? 'TIMEOUT' : 'OLLAMA_NO_DISPONIBLE');
    } finally { clearTimeout(timer); }
  }
  async comprobarSalud() {
    try {
      const data = await this.solicitar('/api/tags', {}, Math.min(this.timeoutMs, 3000));
      if (!Array.isArray(data?.models)) throw errorIA('RESPUESTA_INVALIDA');
      const modelos = data.models.map(m => m.name).filter(n => typeof n === 'string');
      const nombre = this.model.includes(':') ? this.model : this.model + ':latest';
      return { disponible: true, modelos, modeloConfigurado: this.model,
        tieneModeloConfigurado: !!this.model && modelos.some(m => m === this.model || m === nombre) };
    } catch (err) { return { disponible: false, error: err.codigo, modelos: [] }; }
  }
  estaConfigurado() { return !!this.model; }
  // formato: 'json' o un JSON Schema (salida estructurada de Ollama >= 0.5).
  async generarRespuesta({ prompt, sistemaPrompt = '', temperatura = 0.2, formato = 'json' }) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new ErrorAplicacion('El prompt no puede estar vacío.', 400, 'PROMPT_VACIO');
    if (!this.model) throw errorIA('SERVICIO_IA_NO_CONFIGURADO');
    const data = await this.solicitar('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, system: sistemaPrompt,
        format: formato, stream: false, options: { temperature: temperatura } })
    });
    if (typeof data?.response !== 'string') throw errorIA('RESPUESTA_INVALIDA');
    if (!data.response.trim()) throw errorIA('RESPUESTA_IA_VACIA');
    return { texto: data.response.trim(), modelo: this.model };
  }
}
module.exports = { OllamaProvider, errorIA };
