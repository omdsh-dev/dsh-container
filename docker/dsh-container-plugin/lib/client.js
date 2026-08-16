window.__ModuleLoader__.load({
  id: "dsh-container-plugin",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      Button,
      IconRefreshOutline16,
      RiskConfirmation,
    } = require("@deepseek-ai/dsh-client-ui-primitives");
    const { createElement: h, useCallback, useEffect, useRef, useState } = React;

    const RPC_CHANNEL = "/dsh-container";
    const RESTART_TIMEOUT_MS = 90_000;
    const POLL_INTERVAL_MS = 1_000;
    const REQUEST_TIMEOUT_MS = 3_000;
    const LOCALE_NAMESPACE = "settings.dsh-container";

    const zh = {
      nav: "DSH 容器",
      title: "DSH 容器",
      intro: "当前容器实例的只读有效配置。",
      "group.runtime": "运行环境",
      "group.network": "网络",
      "group.security": "安全",
      "group.maintenance": "维护",
      "field.dshVersion": "DSH 版本",
      "field.timeZone": "时区",
      "field.user": "运行用户",
      "field.relayPort": "Relay 端口",
      "field.internalPort": "DSH 内部端口",
      "field.trustedHosts": "Trusted hosts",
      "field.permissionMode": "权限模式",
      "field.telemetry": "遥测",
      "field.restart": "WebUI 重启",
      "status.enabled": "已启用",
      "status.disabled": "已禁用",
      "status.none": "无",
      "load.loading": "正在读取容器配置...",
      "load.failed": "无法读取容器配置",
      retry: "重试",
      "restart.action": "重启容器",
      "restart.requesting": "正在提交重启请求...",
      "restart.waiting": "容器正在重启，等待新实例恢复...",
      "restart.failed": "重启请求失败",
      "restart.timeout": "90 秒内未检测到新实例。请检查容器状态后重试。",
      "restart.retry": "重新检测",
      "restart.disabled": "部署未启用 WebUI 重启。",
      "restart.policy": "重启依赖部署者配置的 Docker restart policy，本页面无法自动检测该策略。",
      "confirm.title": "重启 DSH 容器",
      "confirm.description": "这会中断正在运行的 Agent、终端和网络连接。容器退出后必须由 Docker restart policy 拉起。",
      "confirm.acknowledge": "我确认当前任务和连接会被中断",
      "confirm.cancel": "取消",
      "confirm.restart": "重启容器",
    };
    const en = {
      nav: "DSH Container",
      title: "DSH Container",
      intro: "Read-only effective configuration for the current container instance.",
      "group.runtime": "Runtime",
      "group.network": "Network",
      "group.security": "Security",
      "group.maintenance": "Maintenance",
      "field.dshVersion": "DSH version",
      "field.timeZone": "Time zone",
      "field.user": "Runtime user",
      "field.relayPort": "Relay port",
      "field.internalPort": "DSH internal port",
      "field.trustedHosts": "Trusted hosts",
      "field.permissionMode": "Permission mode",
      "field.telemetry": "Telemetry",
      "field.restart": "WebUI restart",
      "status.enabled": "Enabled",
      "status.disabled": "Disabled",
      "status.none": "None",
      "load.loading": "Loading the container configuration...",
      "load.failed": "Could not load the container configuration",
      retry: "Retry",
      "restart.action": "Restart container",
      "restart.requesting": "Submitting the restart request...",
      "restart.waiting": "The container is restarting. Waiting for the new instance...",
      "restart.failed": "The restart request failed",
      "restart.timeout": "A new instance was not detected within 90 seconds. Check the container and try again.",
      "restart.retry": "Check again",
      "restart.disabled": "WebUI restart is not enabled by this deployment.",
      "restart.policy": "Restart depends on a Docker restart policy configured by the deployer. This page cannot detect that policy.",
      "confirm.title": "Restart DSH container",
      "confirm.description": "This interrupts running Agents, terminals, and network connections. A Docker restart policy must start the container again after it exits.",
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
.dcp-status{margin:10px 0;color:var(--dsw-alias-label-secondary)}
.dcp-status[role=alert]{color:var(--dsw-alias-label-error)}
.dcp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.dcp-section .dcp-action{max-width:100%;height:auto;min-height:36px;white-space:normal;text-align:center}
.dcp-note{margin:12px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
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
        || typeof value.restartAllowed !== "boolean") {
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
        },
        restartAllowed: value.restartAllowed,
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

    function ContainerSection({ client, t }) {
      const [description, setDescription] = useState(undefined);
      const [loadError, setLoadError] = useState(undefined);
      const [loading, setLoading] = useState(true);
      const [confirmationOpen, setConfirmationOpen] = useState(false);
      const [acknowledged, setAcknowledged] = useState(false);
      const [restartPhase, setRestartPhase] = useState("idle");
      const [restartError, setRestartError] = useState(undefined);
      const previousInstanceId = useRef(undefined);
      const loadGeneration = useRef(0);

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
        return () => { loadGeneration.current += 1; };
      }, [load]);

      const waitForRestart = useCallback(async (oldInstanceId, initialDelayMs = 0) => {
        setRestartPhase("waiting");
        setRestartError(undefined);
        const deadline = Date.now() + RESTART_TIMEOUT_MS;
        if (initialDelayMs > 0) await delay(initialDelayMs);
        while (Date.now() < deadline) {
          const remaining = deadline - Date.now();
          try {
            const next = await describeWithTimeout(
              client,
              Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remaining)),
            );
            if (next.instanceId !== oldInstanceId) {
              window.location.reload();
              return;
            }
          } catch {
            // 退出和启动期间的网络错误属于预期状态，继续轮询。
          }
          await delay(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
        }
        setRestartPhase("error");
        setRestartError(t("restart.timeout"));
      }, [client, t]);

      const restart = useCallback(async () => {
        if (description === undefined || restartPhase === "requesting" || restartPhase === "waiting") return;
        setConfirmationOpen(false);
        setAcknowledged(false);
        setRestartPhase("requesting");
        setRestartError(undefined);
        previousInstanceId.current = description.instanceId;
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

      if (loading && description === undefined) {
        return h("div", { className: "dcp-section", role: "status" }, t("load.loading"));
      }
      if (loadError !== undefined && description === undefined) {
        return h("div", { className: "dcp-section" },
          h("p", { className: "dcp-status", role: "alert" }, `${t("load.failed")}: ${loadError}`),
          h(Button, { variant: "outline", onClick: () => { void load(); } }, t("retry")));
      }
      if (description === undefined) return null;

      const busy = restartPhase === "requesting" || restartPhase === "waiting";
      const restartStatus = restartPhase === "requesting"
        ? t("restart.requesting")
        : restartPhase === "waiting"
          ? t("restart.waiting")
          : restartError;

      return h("div", { className: "dcp-section" },
        h("h2", { className: "dcp-title" }, t("title")),
        h("p", { className: "dcp-intro" }, t("intro")),
        h(Group, { title: t("group.runtime") },
          h("dl", { className: "dcp-list" },
            h(DefinitionRow, { label: t("field.dshVersion") }, description.dshVersion),
            h(DefinitionRow, { label: t("field.timeZone") }, description.timeZone),
            h(DefinitionRow, { label: t("field.user") }, `UID ${description.security.uid} / GID ${description.security.gid}`))),
        h(Group, { title: t("group.network") },
          h("dl", { className: "dcp-list" },
            h(DefinitionRow, { label: t("field.relayPort") }, String(description.relayPort)),
            h(DefinitionRow, { label: t("field.internalPort") }, String(description.internalPort)),
            h(DefinitionRow, { label: t("field.trustedHosts") },
              description.trustedHosts.length === 0
                ? t("status.none")
                : h("span", { className: "dcp-hosts" }, ...description.trustedHosts.map((host, index) =>
                    h("code", { className: "dcp-host", key: `${host}-${index}` }, host)))))),
        h(Group, { title: t("group.security") },
          h("dl", { className: "dcp-list" },
            h(DefinitionRow, { label: t("field.permissionMode") }, description.security.permissionMode),
            h(DefinitionRow, { label: t("field.telemetry") },
              description.security.telemetryDisabled ? t("status.disabled") : t("status.enabled")))),
        h(Group, { title: t("group.maintenance") },
          h("dl", { className: "dcp-list" },
            h(DefinitionRow, { label: t("field.restart") },
              description.restartAllowed ? t("status.enabled") : t("status.disabled"))),
          h("p", { className: "dcp-note" },
            description.restartAllowed ? t("restart.policy") : t("restart.disabled")),
          restartStatus === undefined
            ? null
            : h("p", {
                className: "dcp-status",
                role: restartPhase === "error" ? "alert" : "status",
                "aria-live": "polite",
              }, restartStatus),
          h("div", { className: "dcp-actions" },
            h(Button, {
              variant: "primary",
              className: "dcp-action",
              icon: h(IconRefreshOutline16, { size: 16 }),
              disabled: busy || !description.restartAllowed,
              onClick: () => {
                setAcknowledged(false);
                setConfirmationOpen(true);
              },
            }, t("restart.action")),
            restartPhase === "error" && previousInstanceId.current !== undefined
              ? h(Button, {
                  variant: "outline",
                  className: "dcp-action",
                  disabled: busy,
                  onClick: () => { void waitForRestart(previousInstanceId.current); },
                }, t("restart.retry"))
              : null)),
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
        }));
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
