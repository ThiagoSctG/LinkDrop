package linkdrop

import "net/http"

// apiError is the JSON error contract: a stable machine-readable code plus a pt-BR message.
type apiError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"error"`
}

func (e *apiError) Error() string { return e.Code }

var (
	errRateLimited    = &apiError{http.StatusTooManyRequests, "rate_limited", "Muitas solicitações. Aguarde um minuto e tente novamente."}
	errQRExpired      = &apiError{http.StatusGone, "qr_expired", "Este QR Code expirou ou não está disponível."}
	errQRUsed         = &apiError{http.StatusConflict, "qr_used", "Este QR Code já foi usado."}
	errPairingGone    = &apiError{http.StatusGone, "qr_expired", "Sessão indisponível."}
	errForbidden      = &apiError{http.StatusForbidden, "forbidden", "Sessão indisponível."}
	errSessionGone    = &apiError{http.StatusNotFound, "not_found", "Sessão indisponível."}
	errNotFound       = &apiError{http.StatusNotFound, "not_found", "Não encontrado."}
	errInvalidRequest = &apiError{http.StatusUnprocessableEntity, "invalid_request", "Conteúdo inválido."}
	errContentEmpty   = &apiError{http.StatusUnprocessableEntity, "content_empty", "Escreva um link ou texto antes de enviar."}
	errContentLong    = &apiError{http.StatusUnprocessableEntity, "content_too_long", "O conteúdo deve ter até 10.000 caracteres."}
	errTitleLong      = &apiError{http.StatusUnprocessableEntity, "title_too_long", "O título deve ter até 200 caracteres."}
	errSessionFull    = &apiError{http.StatusUnprocessableEntity, "session_full", "A lista atingiu o limite de itens. Remova itens ou limpe a lista."}
	errScreenOnly     = &apiError{http.StatusForbidden, "screen_only", "Somente a tela pode fazer isso."}
	errBodyTooLarge   = &apiError{http.StatusRequestEntityTooLarge, "body_too_large", "A solicitação excede o limite permitido."}
	errUnauthorized   = &apiError{http.StatusUnauthorized, "unauthorized", "Sessão indisponível."}
	errShuttingDown   = &apiError{http.StatusServiceUnavailable, "shutting_down", "O servidor está reiniciando. Tente novamente em instantes."}
	errInternal       = &apiError{http.StatusInternalServerError, "internal", "Erro interno do servidor."}
)
