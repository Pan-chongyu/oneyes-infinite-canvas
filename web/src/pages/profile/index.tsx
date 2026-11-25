import { useTranslation } from "react-i18next";

import { OneYesAccountPanel } from "@/components/layout/oneyes-account-panel";

export default function ProfilePage() {
    const { t } = useTranslation();

    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
                <header className="mb-5">
                    <h1 className="m-0! text-2xl font-semibold tracking-tight">{t("navigation.profile")}</h1>
                    <p className="mb-0 mt-1.5 text-sm text-muted-foreground">{t("profile.description")}</p>
                </header>
                <OneYesAccountPanel />
            </div>
        </main>
    );
}
