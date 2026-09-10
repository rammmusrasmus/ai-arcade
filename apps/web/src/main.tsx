import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import { Layout } from "./components/Layout";
import { BrowsePage } from "./pages/BrowsePage";
import { GameDetailPage } from "./pages/GameDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { SubmitPage } from "./pages/SubmitPage";
import { EditGamePage } from "./pages/EditGamePage";
import { MyGamesPage } from "./pages/MyGamesPage";
import { ModerationPage } from "./pages/ModerationPage";
import { ProfilePage } from "./pages/ProfilePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <BrowsePage /> },
      { path: "/games/:slug", element: <GameDetailPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/submit", element: <SubmitPage /> },
      { path: "/manage/:slug", element: <EditGamePage /> },
      { path: "/my-games", element: <MyGamesPage /> },
      { path: "/profile", element: <ProfilePage /> },
      { path: "/moderation", element: <ModerationPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
