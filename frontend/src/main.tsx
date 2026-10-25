import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { startFrenchTypography } from "./lib/typo";
import "./styles/fonts";
import "./styles/tokens.css";
import "./styles/base.css";

const root = document.getElementById("root")!;
startFrenchTypography(root);
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
