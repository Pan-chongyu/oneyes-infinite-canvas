import { Button, Modal } from "antd";
import { Download } from "lucide-react";
import { saveAs } from "file-saver";
import { Streamdown } from "streamdown";
import { useTranslation } from "react-i18next";
import guide from "../../../../docs/content/docs/development/canvas-node-plugins.zh-CN.mdx?raw";
import example from "../../../public/plugin-examples/quick-note.mjs?raw";

const markdown = guide.replace(/^---[\s\S]*?---\s*/, "");

export function CanvasPluginGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    return (
        <Modal title={t("canvas.plugins.guideTitle")} open={open} onCancel={onClose} centered width={760} footer={<div className="flex flex-wrap justify-end gap-2"><Button onClick={() => saveAs(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), "OneYes-Canvas-节点开发.md")}>{t("canvas.plugins.downloadGuide")}</Button><Button icon={<Download className="size-4" />} onClick={() => saveAs(new Blob([example], { type: "text/javascript;charset=utf-8" }), "quick-note.mjs")}>{t("canvas.plugins.downloadExample")}</Button></div>}>
            <div className="thin-scrollbar max-h-[60vh] overflow-auto pr-3 text-sm leading-7" data-plugin-guide>
                <Streamdown mode="static">{markdown}</Streamdown>
            </div>
        </Modal>
    );
}
