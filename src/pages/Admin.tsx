// FIX: removido import de useState que não era utilizado (warning de build)
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminDevices } from "@/components/admin/AdminDevices";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { Button } from "@/components/ui/button";
import { LogOut, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";

export default function Admin() {
const { signOut } = useAuth();
const navigate = useNavigate();

return (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border bg-card sticky top-0 z-10">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo className="h-8 object-contain" />
          <span className="text-sm font-bold tracking-widest text-primary">ADMIN</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Pesquisa
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-1" /> Sair
          </Button>
        </div>
      </div>
    </header>

    <main className="container mx-auto px-4 py-6">
      <Tabs defaultValue="devices">
        <TabsList className="mb-6">
          <TabsTrigger value="devices">Dispositivos</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
        </TabsList>
        <TabsContent value="devices">
          <AdminDevices />
        </TabsContent>
        <TabsContent value="users">
          <AdminUsers />
        </TabsContent>
      </Tabs>
    </main>
  </div>
);
}
