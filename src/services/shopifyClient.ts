export function createShopifyClient(shopDomain: string, accessToken: string) {
  const baseUrl = `https://${shopDomain}/admin/api/2024-07`;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(baseUrl + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
        ...(init.headers || {}),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify error ${res.status}: ${text}`);
    }

    return (await res.json()) as T;
  }

  return {
    getProducts: () => request<{ products: any[] }>("/products.json?limit=5"),
  };
}