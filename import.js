const axios = require("axios");
const fs = require("fs");

const CONFIG = {
  store: "nsk-rota.myshopify.com",
  accessToken: "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",
  apiVersion: "2024-10",
  rateLimit: 550,
};

let stats = {
  total: 0,
  success: 0,
  failed: 0,
  errors: [],
};

// ✅ Yeni fonksiyon: Variant güncelleme
async function updateProductVariant(productId, variantData) {
  // Önce variant ID'yi al
  const queryVariants = `
    query getProduct($id: ID!) {
      product(id: $id) {
        variants(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
    }
  `;

  try {
    const variantsResponse = await axios.post(
      `https://${CONFIG.store}/admin/api/${CONFIG.apiVersion}/graphql.json`,
      {
        query: queryVariants,
        variables: { id: productId },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": CONFIG.accessToken,
        },
      }
    );

    const variantId =
      variantsResponse.data?.data?.product?.variants?.edges?.[0]?.node?.id;

    if (!variantId) {
      throw new Error("Variant ID bulunamadı");
    }

    // Variant'ı güncelle
    const updateMutation = `
      mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant {
            id
            sku
            price
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const updateResponse = await axios.post(
      `https://${CONFIG.store}/admin/api/${CONFIG.apiVersion}/graphql.json`,
      {
        query: updateMutation,
        variables: {
          input: {
            id: variantId,
            sku: variantData.sku,
            price: variantData.price,
            weight: variantData.weight,
            weightUnit: variantData.weightUnit,
            inventoryPolicy: "DENY",
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": CONFIG.accessToken,
        },
      }
    );

    return updateResponse.data;
  } catch (error) {
    console.error("⚠️  Variant güncelleme hatası:", error.message);
    return null;
  }
}

async function createProduct(product) {
  const mutation = `
    mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
      productCreate(input: $input, media: $media) {
        product {
          id
          title
          handle
          featuredImage {
            url
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Ağırlık parse
  let weightValue = 0;
  let weightUnit = "POUNDS";

  if (product.Weight?.lb) {
    const lbMatch = product.Weight.lb.match(/[\d,\.]+/);
    if (lbMatch) {
      weightValue = parseFloat(lbMatch[0].replace(",", "."));
    }
  } else if (product.Weight?.kg) {
    const kgMatch = product.Weight.kg.match(/[\d,\.]+/);
    if (kgMatch) {
      weightValue = parseFloat(kgMatch[0].replace(",", "."));
      weightUnit = "KILOGRAMS";
    }
  }

  const vendor = product.Brands?.[0]?.BrandDescription || "";
  const productType = product.Brands?.[0]?.BrandClass || "";

  const tags = [
    productType,
    ...product.Brands.map((b) => b.BrandDescription),
    ...product.Oems.map((oem) => oem.MarkaDescription),
    ...product.Competiters.map((c) => c.CompetitorName),
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  let descriptionHtml = `<p>${product.ProductEn}</p>`;

  const metafields = [];

  if (product.Oems && product.Oems.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "oem_info",
      type: "json",
      value: JSON.stringify(product.Oems),
    });
  }

  if (product.Details && product.Details.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "technical_info",
      type: "json",
      value: JSON.stringify(product.Details),
    });
  }

  if (product.Competiters && product.Competiters.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "competitor_info",
      type: "json",
      value: JSON.stringify(product.Competiters),
    });
  }

  if (product.Components && product.Components.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "comp",
      type: "json",
      value: JSON.stringify(product.Components),
    });
  }

  if (product.Applications && product.Applications.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "applications",
      type: "json",
      value: JSON.stringify(product.Applications),
    });
  }

  if (product.Pairings && product.Pairings.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "pairings",
      type: "json",
      value: JSON.stringify(product.Pairings),
    });
  }

  if (product.Brands && product.Brands.length > 0) {
    metafields.push({
      namespace: "custom",
      key: "brand_info",
      type: "json",
      value: JSON.stringify(product.Brands),
    });
  }

  const media =
    product.Photos && product.Photos.length > 0
      ? product.Photos.map((url, index) => ({
          originalSource: url,
          alt: `${product.ProductEn} - Image ${index + 1}`,
          mediaContentType: "IMAGE",
        }))
      : [];

  // ✅ DÜZELTİLMİŞ: productOptions kullan, variants kaldır
  const variables = {
    input: {
      title: product.ProductEn,
      descriptionHtml: descriptionHtml,
      vendor: vendor,
      productType: productType,
      status: "ACTIVE",
      tags: tags,
      productOptions: [
        {
          name: "Title",
          values: [{ name: "Default Title" }],
        },
      ],
      metafields: metafields,
    },
    media: media.length > 0 ? media : undefined,
  };

  try {
    const response = await axios.post(
      `https://${CONFIG.store}/admin/api/${CONFIG.apiVersion}/graphql.json`,
      {
        query: mutation,
        variables: variables,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": CONFIG.accessToken,
        },
      }
    );

    // ✅ Ürün başarıyla oluşturulduysa variant'ı güncelle
    if (response.data?.data?.productCreate?.product?.id) {
      const productId = response.data.data.productCreate.product.id;

      await updateProductVariant(productId, {
        sku: product.RotaNo,
        price: product.Price ? product.Price.toString() : "0.00",
        weight: weightValue,
        weightUnit: weightUnit,
      });
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
      );
    }
    throw new Error(`API Error: ${error.message}`);
  }
}

async function bulkImport(jsonFile) {
  console.log("🚀 Shopify Bulk Product Import Başlıyor...\n");

  let products;
  try {
    const fileContent = fs.readFileSync(jsonFile, "utf8");
    products = JSON.parse(fileContent);
  } catch (error) {
    console.error("❌ JSON dosyası okunamadı:", error.message);
    return;
  }

  stats.total = products.length;
  console.log(`📦 Toplam ${stats.total} ürün import edilecek\n`);
  console.log("─".repeat(60));

  const startTime = Date.now();

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const progress = `[${i + 1}/${stats.total}]`;

    try {
      const result = await createProduct(product);

      if (result.data?.productCreate?.userErrors?.length > 0) {
        const errors = result.data.productCreate.userErrors;
        console.error(
          `❌ ${progress} ${product.RotaNo} - ${product.ProductEn}`
        );
        console.error(`   Hatalar: ${JSON.stringify(errors)}\n`);

        stats.failed++;
        stats.errors.push({
          sku: product.RotaNo,
          title: product.ProductEn,
          errors: errors,
        });
      } else if (result.data?.productCreate?.product) {
        const createdProduct = result.data.productCreate.product;
        console.log(`✅ ${progress} ${product.RotaNo} - ${product.ProductEn}`);
        console.log(`   ID: ${createdProduct.id}`);
        console.log(`   Handle: ${createdProduct.handle}`);
        console.log(`   Görseller: ${product.Photos?.length || 0} adet\n`);

        stats.success++;
      } else {
        throw new Error("Beklenmeyen response formatı");
      }
    } catch (error) {
      console.error(
        `❌ ${progress} ${product.RotaNo} - HATA: ${error.message}\n`
      );
      stats.failed++;
      stats.errors.push({
        sku: product.RotaNo,
        title: product.ProductEn,
        errors: [{ message: error.message }],
      });
    }

    await new Promise((resolve) => setTimeout(resolve, CONFIG.rateLimit));

    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const remaining = stats.total - (i + 1);
      const eta = ((remaining * CONFIG.rateLimit) / 1000 / 60).toFixed(1);

      console.log("─".repeat(60));
      console.log(
        `📊 İlerleme: ${i + 1}/${stats.total} | Başarılı: ${
          stats.success
        } | Hatalı: ${stats.failed}`
      );
      console.log(`⏱️  Geçen süre: ${elapsed} dk | Tahmini kalan: ${eta} dk\n`);
      console.log("─".repeat(60));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("🎉 IMPORT TAMAMLANDI!");
  console.log("=".repeat(60));
  console.log(`📊 Toplam: ${stats.total} ürün`);
  console.log(`✅ Başarılı: ${stats.success} ürün`);
  console.log(`❌ Hatalı: ${stats.failed} ürün`);
  console.log(`⏱️  Toplam süre: ${totalTime} dakika`);
  console.log("=".repeat(60));

  if (stats.errors.length > 0) {
    const errorReport = {
      timestamp: new Date().toISOString(),
      summary: stats,
      errors: stats.errors,
    };

    fs.writeFileSync(
      "import-errors.json",
      JSON.stringify(errorReport, null, 2)
    );

    console.log("\n⚠️  Hata raporu kaydedildi: import-errors.json");
  }
}

const jsonFile = process.argv[2] || "./products.json";
console.log(`📁 Dosya: ${jsonFile}\n`);

bulkImport(jsonFile).catch((error) => {
  console.error("💥 Fatal Error:", error);
  process.exit(1);
});
