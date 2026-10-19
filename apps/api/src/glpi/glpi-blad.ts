/**
 * Błąd integracji z GLPI — zawsze z komunikatem gotowym do pokazania
 * administratorowi. Kontroler przekłada go na `BadGateway` (502), bo
 * problem jest po stronie GLPI, nie w danych formularza.
 */
export class GlpiBlad extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlpiBlad';
  }
}
