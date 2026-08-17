window.__ModuleLoader__.load({
  id: "dsh-container-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      Button,
      IconLoadingOutline16,
      IconRefreshOutline16,
      Modal,
      RiskConfirmation,
    } = require("@deepseek-ai/dsh-client-ui-primitives");
    const { createElement: h, useCallback, useEffect, useRef, useState } = React;

    const RPC_CHANNEL = "/dsh-container";
    const LOGIN_PATH = "/_dsh-container/auth/login";
    const LOGOUT_PATH = "/_dsh-container/auth/logout";
    const RESTART_MANUAL_CHECK_MS = 90_000;
    const POLL_INTERVAL_MS = 1_000;
    const REQUEST_TIMEOUT_MS = 3_000;
    const LOCALE_NAMESPACE = "settings.dsh-container";

    const zh = {
      nav: "DSH 容器",
      title: "DSH 容器",
      intro: "当前容器实例的只读有效配置。",
      "group.runtime": "运行环境",
      "group.networkSecurity": "网络和安全",
      "group.authentication": "身份认证",
      "group.maintenance": "维护",
      "field.dshVersion": "DSH 版本",
      "field.timeZone": "时区",
      "field.user": "运行用户",
      "field.ports": "端口",
      "field.trustedHosts": "Trusted hosts",
      "field.permissionMode": "权限模式",
      "field.telemetry": "遥测",
      "field.authentication": "管理员密钥认证",
      "status.enabled": "已启用",
      "status.disabled": "已禁用",
      "status.none": "无",
      "load.loading": "正在读取容器配置...",
      "load.failed": "无法读取容器配置",
      retry: "重试",
      "logout.action": "退出本设备",
      "logout.progress": "正在退出...",
      "logout.failed": "退出失败",
      "restart.action": "重启容器",
      "restart.requesting": "正在提交重启请求...",
      "restart.waiting": "容器正在重启，等待新实例恢复...",
      "restart.failed": "重启请求失败",
      "restart.manualCheck": "容器可能无法启动，请检查 Docker 容器状态并手动启动。",
      "confirm.title": "重启 DSH 容器",
      "confirm.description": "这会中断正在运行的 Agent、终端和网络连接。容器退出后，Docker restart policy 必须为 on-failure[:max-retries]、always 或 unless-stopped 才能自动拉起；no 或未配置会使容器保持停止。",
      "confirm.acknowledge": "我确认当前任务和连接会被中断",
      "confirm.cancel": "取消",
      "confirm.restart": "重启容器",
    };
    const en = {
      nav: "DSH Container",
      title: "DSH Container",
      intro: "Read-only effective configuration for the current container instance.",
      "group.runtime": "Runtime",
      "group.networkSecurity": "Network and security",
      "group.authentication": "Authentication",
      "group.maintenance": "Maintenance",
      "field.dshVersion": "DSH version",
      "field.timeZone": "Time zone",
      "field.user": "Runtime user",
      "field.ports": "Ports",
      "field.trustedHosts": "Trusted hosts",
      "field.permissionMode": "Permission mode",
      "field.telemetry": "Telemetry",
      "field.authentication": "Administrator key authentication",
      "status.enabled": "Enabled",
      "status.disabled": "Disabled",
      "status.none": "None",
      "load.loading": "Loading the container configuration...",
      "load.failed": "Could not load the container configuration",
      retry: "Retry",
      "logout.action": "Sign out this device",
      "logout.progress": "Signing out...",
      "logout.failed": "Sign out failed",
      "restart.action": "Restart container",
      "restart.requesting": "Submitting the restart request...",
      "restart.waiting": "The container is restarting. Waiting for the new instance...",
      "restart.failed": "The restart request failed",
      "restart.manualCheck": "The container may not be starting. Check its Docker status and start it manually.",
      "confirm.title": "Restart DSH container",
      "confirm.description": "This interrupts running Agents, terminals, and network connections. After the container exits, its Docker restart policy must be on-failure[:max-retries], always, or unless-stopped to start it automatically; no or an unset policy leaves the container stopped.",
      "confirm.acknowledge": "I understand that current work and connections will be interrupted",
      "confirm.cancel": "Cancel",
      "confirm.restart": "Restart container",
    };

    const css = `
.dcp-section{box-sizing:border-box;width:100%;min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dcp-title{margin:0;font-size:20px;font-weight:600;line-height:28px;letter-spacing:0}
.dcp-intro{margin:6px 0 24px;color:var(--dsw-alias-label-secondary)}
.dcp-group{padding:0 0 22px;margin:0 0 22px;border-bottom:1px solid var(--dsw-alias-separator-primary)}
.dcp-group:last-child{margin-bottom:0;border-bottom:0}
.dcp-heading{margin:0 0 10px;font-size:14px;font-weight:600;line-height:22px;letter-spacing:0}
.dcp-list{margin:0}
.dcp-row{display:grid;grid-template-columns:minmax(120px,180px) minmax(0,1fr);gap:12px;padding:8px 0}
.dcp-row dt{color:var(--dsw-alias-label-secondary)}
.dcp-row dd{min-width:0;margin:0;overflow-wrap:anywhere}
.dcp-hosts{display:flex;flex-wrap:wrap;gap:6px}
.dcp-host{max-width:100%;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:var(--dsw-alias-bg-layer-1);font-family:var(--dsw-font-mono);font-size:12px;line-height:20px;overflow-wrap:anywhere}
.dcp-status{margin:0 0 12px;color:var(--dsw-alias-label-secondary)}
.dcp-status[role=alert]{color:var(--dsw-alias-label-error)}
.dcp-actions{display:flex;flex-wrap:wrap;gap:8px}
.dcp-section .dcp-action{max-width:100%;height:auto;min-height:36px;white-space:normal;text-align:center}
.dcp-restart-dialog{width:min(420px,100%);padding:0}
.dcp-restart-status{display:flex;min-width:0;flex-direction:column;align-items:center;gap:14px;padding:28px 24px;text-align:center;outline:none}
.dcp-restart-spinner{display:block;color:var(--dsw-alias-label-secondary);animation:dcp-spin 1s linear infinite}
.dcp-restart-message{max-width:100%;margin:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
@keyframes dcp-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dcp-restart-spinner{animation:none}}
@media(max-width:600px){[role=dialog]:has(.dcp-section){flex-direction:column}[role=dialog]:has(.dcp-section)>nav{width:100%;padding:12px 12px 0;gap:8px}[role=dialog]:has(.dcp-section)>nav>div:last-child{flex-direction:row;flex-wrap:wrap;overflow:visible;padding-bottom:8px}[role=dialog]:has(.dcp-section)>nav button{flex:none;width:auto;min-width:max-content}[role=dialog]:has(.dcp-section)>nav+div{width:100%;min-height:0}.dcp-title{font-size:18px;line-height:26px}.dcp-intro{margin-bottom:18px}.dcp-row{grid-template-columns:minmax(0,1fr);gap:2px;padding:9px 0}.dcp-actions{align-items:stretch}.dcp-section .dcp-action{width:100%;padding:7px 10px}.dcp-hosts{display:block}.dcp-host{display:block;margin:0 0 4px}}
`;
    const styleId = "dsh-container-plugin/settings.css";
    if (document.querySelector(`style[data-plugin-css=${JSON.stringify(styleId)}]`) === null) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-container-plugin";
      style.dataset.pluginCss = styleId;
      style.textContent = css;
      document.head.appendChild(style);
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function isRecord(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function parseDescription(value) {
      if (!isRecord(value)
        || typeof value.instanceId !== "string"
        || typeof value.dshVersion !== "string"
        || !Array.isArray(value.trustedHosts)
        || value.trustedHosts.some((host) => typeof host !== "string")
        || !Number.isInteger(value.relayPort)
        || !Number.isInteger(value.internalPort)
        || typeof value.timeZone !== "string"
        || !isRecord(value.security)
        || !Number.isInteger(value.security.uid)
        || !Number.isInteger(value.security.gid)
        || typeof value.security.permissionMode !== "string"
        || typeof value.security.telemetryDisabled !== "boolean"
        || typeof value.security.authenticationEnabled !== "boolean") {
        throw new Error("invalid dsh-container describe response");
      }
      return {
        instanceId: value.instanceId,
        dshVersion: value.dshVersion,
        trustedHosts: [...value.trustedHosts],
        relayPort: value.relayPort,
        internalPort: value.internalPort,
        timeZone: value.timeZone,
        security: {
          uid: value.security.uid,
          gid: value.security.gid,
          permissionMode: value.security.permissionMode,
          telemetryDisabled: value.security.telemetryDisabled,
          authenticationEnabled: value.security.authenticationEnabled,
        },
      };
    }

    async function call(client, endpoint, signal) {
      const result = await client.rpc.call(RPC_CHANNEL, endpoint, {}, signal);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    }

    function describe(client, signal) {
      return call(client, "describe", signal).then(parseDescription);
    }

    async function describeWithTimeout(client, timeoutMs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, timeoutMs);
      try {
        return await describe(client, controller.signal);
      } finally {
        clearTimeout(timeout);
      }
    }

    function delay(milliseconds) {
      return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
    }

    function DefinitionRow({ label, children }) {
      return h("div", { className: "dcp-row" },
        h("dt", null, label),
        h("dd", null, children));
    }

    function Group({ title, children }) {
      return h("section", { className: "dcp-group" },
        h("h3", { className: "dcp-heading" }, title),
        children);
    }

    function RestartStatusModal({ phase, t }) {
      const statusRef = useRef(null);
      const busy = phase === "requesting" || phase === "waiting" || phase === "manual";

      useEffect(() => {
        if (!busy) return undefined;
        const appRoot = document.getElementById("root");
        const previousInert = appRoot?.inert;
        const previousBodyOverflow = document.body.style.overflow;
        if (appRoot !== null) appRoot.inert = true;
        document.body.style.overflow = "hidden";

        const focusStatus = () => {
          statusRef.current?.focus({ preventScroll: true });
        };
        const keepFocusInStatus = (event) => {
          if (statusRef.current !== null && !statusRef.current.contains(event.target)) {
            focusStatus();
          }
        };
        const blockBackgroundKeyboard = (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.key === "Tab") focusStatus();
        };

        focusStatus();
        document.addEventListener("focusin", keepFocusInStatus, true);
        document.addEventListener("keydown", blockBackgroundKeyboard, true);
        return () => {
          document.removeEventListener("focusin", keepFocusInStatus, true);
          document.removeEventListener("keydown", blockBackgroundKeyboard, true);
          if (appRoot !== null) appRoot.inert = previousInert ?? false;
          document.body.style.overflow = previousBodyOverflow;
        };
      }, [busy]);

      const message = phase === "requesting"
        ? t("restart.requesting")
        : phase === "manual"
          ? t("restart.manualCheck")
          : t("restart.waiting");

      return h(Modal, {
        open: busy,
        title: message,
        onClose: () => {},
        headless: true,
        className: "dcp-restart-dialog",
      },
      h("div", {
        ref: statusRef,
        className: "dcp-restart-status",
        role: "status",
        tabIndex: -1,
        "aria-busy": true,
        "aria-live": "polite",
      },
      h("span", { "aria-hidden": true },
        h(IconLoadingOutline16, {
          size: 24,
          className: "dcp-restart-spinner",
        })),
      h("p", { className: "dcp-restart-message" }, message)));
    }

    function ContainerSection({ client, t }) {
      const [description, setDescription] = useState(undefined);
      const [loadError, setLoadError] = useState(undefined);
      const [loading, setLoading] = useState(true);
      const [confirmationOpen, setConfirmationOpen] = useState(false);
      const [acknowledged, setAcknowledged] = useState(false);
      const [restartPhase, setRestartPhase] = useState("idle");
      const [restartError, setRestartError] = useState(undefined);
      const [logoutPhase, setLogoutPhase] = useState("idle");
      const [logoutError, setLogoutError] = useState(undefined);
      const loadGeneration = useRef(0);
      const restartGeneration = useRef(0);

      const load = useCallback(async () => {
        const generation = ++loadGeneration.current;
        setLoading(true);
        setLoadError(undefined);
        try {
          const next = await describe(client);
          if (generation === loadGeneration.current) setDescription(next);
        } catch (error) {
          if (generation === loadGeneration.current) setLoadError(messageOf(error));
        } finally {
          if (generation === loadGeneration.current) setLoading(false);
        }
      }, [client]);

      useEffect(() => {
        void load();
        return () => {
          loadGeneration.current += 1;
          restartGeneration.current += 1;
        };
      }, [load]);

      const waitForRestart = useCallback(async (oldInstanceId, initialDelayMs = 0) => {
        const generation = ++restartGeneration.current;
        setRestartPhase("waiting");
        const manualCheckTimer = setTimeout(() => {
          if (generation === restartGeneration.current) setRestartPhase("manual");
        }, RESTART_MANUAL_CHECK_MS);
        try {
          if (initialDelayMs > 0) await delay(initialDelayMs);
          while (generation === restartGeneration.current) {
            try {
              const next = await describeWithTimeout(client, REQUEST_TIMEOUT_MS);
              if (next.instanceId !== oldInstanceId) {
                window.location.reload();
                return;
              }
            } catch {
              // 退出和启动期间的网络错误属于预期状态，继续轮询。
            }
            await delay(POLL_INTERVAL_MS);
          }
        } finally {
          clearTimeout(manualCheckTimer);
        }
      }, [client]);

      const restart = useCallback(async () => {
        if (description === undefined
          || restartPhase === "requesting"
          || restartPhase === "waiting"
          || restartPhase === "manual") return;
        setConfirmationOpen(false);
        setAcknowledged(false);
        setRestartPhase("requesting");
        setRestartError(undefined);
        try {
          const value = await call(client, "restart");
          if (!isRecord(value)
            || value.accepted !== true
            || value.instanceId !== description.instanceId
            || !Number.isInteger(value.restartAfterMs)
            || value.restartAfterMs < 0) {
            throw new Error("invalid dsh-container restart response");
          }
          await waitForRestart(description.instanceId, value.restartAfterMs);
        } catch (error) {
          setRestartPhase("error");
          setRestartError(`${t("restart.failed")}: ${messageOf(error)}`);
        }
      }, [client, description, restartPhase, t, waitForRestart]);

      const logout = useCallback(async () => {
        if (logoutPhase === "requesting") return;
        setLogoutPhase("requesting");
        setLogoutError(undefined);
        try {
          const response = await globalThis.fetch(LOGOUT_PATH, { method: "POST" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          window.location.assign(LOGIN_PATH);
        } catch (error) {
          setLogoutPhase("error");
          setLogoutError(`${t("logout.failed")}: ${messageOf(error)}`);
        }
      }, [logoutPhase, t]);

      if (loading && description === undefined) {
        return h("div", { className: "dcp-section", role: "status" }, t("load.loading"));
      }
      if (loadError !== undefined && description === undefined) {
        return h("div", { className: "dcp-section" },
          h("p", { className: "dcp-status", role: "alert" }, `${t("load.failed")}: ${loadError}`),
          h(Button, { variant: "outline", onClick: () => { void load(); } }, t("retry")));
      }
      if (description === undefined) return null;

      const busy = restartPhase === "requesting"
        || restartPhase === "waiting"
        || restartPhase === "manual";
      const logoutBusy = logoutPhase === "requesting";

      return h("div", { className: "dcp-section" },
        h("h2", { className: "dcp-title" }, t("title")),
        h("p", { className: "dcp-intro" }, t("intro")),
        h(Group, { title: t("group.runtime") },
          h("dl", { className: "dcp-list" },
            h(DefinitionRow, { label: t("field.dshVersion") }, description.dshVersion),
            h(DefinitionRow, { label: t("field.timeZone") }, description.timeZone),
            h(DefinitionRow, { label: t("field.user") }, `UID ${description.security.uid} / GID ${description.security.gid}`))),
        h(Group, { title: t("group.networkSecurity") },
          h("dl", { className: "dcp-list" },
            h(DefinitionRow, { label: t("field.ports") },
              `${description.relayPort}(Relay) => ${description.internalPort}(DSH)`),
            h(DefinitionRow, { label: t("field.trustedHosts") },
              description.trustedHosts.length === 0
                ? t("status.none")
                : h("span", { className: "dcp-hosts" }, ...description.trustedHosts.map((host, index) =>
                    h("code", { className: "dcp-host", key: `${host}-${index}` }, host)))),
            h(DefinitionRow, { label: t("field.permissionMode") }, description.security.permissionMode),
            h(DefinitionRow, { label: t("field.telemetry") },
              description.security.telemetryDisabled ? t("status.disabled") : t("status.enabled")))),
        h(Group, { title: t("group.authentication") },
          h("dl", { className: "dcp-list" },
            h(DefinitionRow, { label: t("field.authentication") },
              description.security.authenticationEnabled ? t("status.enabled") : t("status.disabled"))),
          !description.security.authenticationEnabled
            ? null
            : h("div", null,
              logoutError === undefined
                ? null
                : h("p", { className: "dcp-status", role: "alert" }, logoutError),
              h(Button, {
                variant: "outline",
                className: "dcp-action",
                icon: logoutBusy ? h(IconLoadingOutline16, {
                  size: 16,
                  className: "dcp-restart-spinner",
                }) : undefined,
                disabled: logoutBusy || busy,
                onClick: () => { void logout(); },
              }, logoutBusy ? t("logout.progress") : t("logout.action")))),
        h(Group, { title: t("group.maintenance") },
          restartError === undefined
            ? null
            : h("p", {
                className: "dcp-status",
                role: "alert",
              }, restartError),
          h("div", { className: "dcp-actions" },
            h(Button, {
              variant: "primary",
              className: "dcp-action",
              icon: h(IconRefreshOutline16, { size: 16 }),
              disabled: busy || logoutBusy,
              onClick: () => {
                setAcknowledged(false);
                setConfirmationOpen(true);
              },
            }, t("restart.action")))),
        h(RiskConfirmation, {
          open: confirmationOpen,
          title: t("confirm.title"),
          description: t("confirm.description"),
          acknowledgeLabel: t("confirm.acknowledge"),
          cancelLabel: t("confirm.cancel"),
          confirmLabel: t("confirm.restart"),
          acknowledged,
          disabled: busy,
          onAcknowledgedChange: setAcknowledged,
          onCancel: () => {
            if (busy) return;
            setAcknowledged(false);
            setConfirmationOpen(false);
          },
          onConfirm: () => { void restart(); },
        }),
        h(RestartStatusModal, { phase: restartPhase, t }));
    }

    const inject = ["slots", "locale", "connection"];

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }),
        "dsh-container: dictionaries",
      );
      const t = ctx.locale.bind(LOCALE_NAMESPACE);
      const client = ctx.get("connection");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "dsh-container",
        order: 30,
        label: () => t("nav"),
        locale: LOCALE_NAMESPACE,
        inject: () => ({ client }),
      }, ContainerSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
