"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("@fastify/cors"));
const auth_1 = require("./routes/auth");
const orders_1 = require("./routes/orders");
const products_1 = require("./routes/products");
dotenv_1.default.config();
const app = (0, fastify_1.default)({ logger: true });
app.register(cors_1.default, {
    origin: "*", // en el futuro lo restringimos a tu dominio de Vercel
});
app.get("/health", async () => {
    return { status: "ok", service: "fluxi-backend" };
});
(0, auth_1.authRoutes)(app);
(0, orders_1.orderRoutes)(app);
(0, products_1.productRoutes)(app);
const port = Number(process.env.PORT) || 4000;
app
    .listen({ port, host: "0.0.0.0" })
    .then(() => {
    console.log(`🚀 Fluxi backend running on port ${port}`);
})
    .catch((err) => {
    app.log.error(err);
    process.exit(1);
});
