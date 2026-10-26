# syntax=docker/dockerfile:1

# Frontend: platform-independent static files.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts vitest.config.ts ./
COPY web ./web
RUN npm run build

# Server: cross-compiled static binary with the frontend embedded.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS server
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web/embed.go ./web/
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/linkdrop ./cmd/linkdrop

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/linkdrop /linkdrop
USER nonroot:nonroot
EXPOSE 47821
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 CMD ["/linkdrop", "healthcheck"]
ENTRYPOINT ["/linkdrop"]
