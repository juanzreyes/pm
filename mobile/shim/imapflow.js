// El correo por IMAP necesita sockets TCP, que un WebView no tiene. En Android el correo llega por
// Microsoft 365 / Gmail (API web) o se ve desde la PC sincronizada.
class ImapFlow { constructor() { this.usable = false; } async connect() { throw new Error('El correo IMAP no está disponible en Android (usa Microsoft 365 o mira el de la PC)'); } on() { return this; } async logout() {} close() {} }
module.exports = { ImapFlow };
