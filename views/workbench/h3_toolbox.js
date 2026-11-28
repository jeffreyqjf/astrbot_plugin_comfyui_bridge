export function mountH3Toolbox({bridge, host, getPrompt, setPrompt, status, submit}) {
  const editor = host.querySelector("[data-toolbox-panels]");
  let current = null;
  let transition = Promise.resolve();

  async function watch(jobs, target = current) {
    if (!target || target !== current) return;
    try {
      for (const job of jobs) {
        while (target === current) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          if (target !== current) return;
          const result = await bridge.apiGet("studio/h3/toolbox/result", {id: job.id});
          if (["completed", "failed", "cancelled"].includes(result.state)) {
            target.panel?.result(result.outputs ?? {});
            if (result.state !== "completed") status(result.message || "H3 任务未完成。", true);
            break;
          }
        }
      }
    } catch (error) {
      if (target === current) status(error.message, true);
    }
  }

  async function run(action, button) {
    const target = current;
    button.disabled = true;
    try {
      const values = target.panel.values(action);
      const result = await submit({workflow:target.name, h3_toolbox_action:action, h3_toolbox:values});
      status(`已加入任务 ${result.jobs[0].id.slice(0, 8)}。`);
      await watch(result.jobs, target);
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  }

  return {
    show(name, panels) {
      const key = name && panels ? JSON.stringify([name, panels]) : "";
      host.hidden = !key;
      if (current?.key === key) return current.ready;
      const next = key ? {key, name, panel:null} : null;
      const previous = current;
      current = next;
      transition = transition.then(async () => {
        previous?.panel?.dispose();
        if (current !== next) return;
        editor.replaceChildren();
        if (!next) return;
        status("正在加载 H3 工具箱…");
        const {mountPanels} = await import("./toolbox/host.js");
        if (current !== next) return;
        next.panel = await mountPanels({
          bridge, host:editor, panels, run, initialPrompt:getPrompt(),
          isImage:Boolean(panels.images), onPromptChange:setPrompt,
        });
        if (current === next) status("");
      }).catch(error => {
        if (current === next) status(error.message, true);
      });
      if (next) next.ready = transition;
      return transition;
    },
    async payload() {
      const target = current;
      if (!target) return {};
      await target.ready;
      if (target !== current || !target.panel) throw Error("请等待 H3 工具箱加载完成。");
      return {h3_toolbox:target.panel.values()};
    },
    async restorePrompt() {
      const target = current;
      await target?.ready;
      if (target === current) target?.panel?.setPrompt(getPrompt());
    },
    watch,
  };
}
