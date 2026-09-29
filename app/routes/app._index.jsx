import { randomUUID } from "node:crypto";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

// =========================================================
// ACTION
// =========================================================

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const intent = formData.get("intent");

  // =====================================================
  // STOCK ALERTS
  // =====================================================

  if (intent === "stockAlerts") {
    const response = await admin.graphql(
      `#graphql
        query StockAlerts {
          lowStock: productVariants(
            first: 50
            query: "inventory_quantity:>0 inventory_quantity:<=5 gift_card:false"
            sortKey: INVENTORY_QUANTITY
          ) {
            nodes {
              id
              title
              sku
              price
              inventoryQuantity

              inventoryItem {
                tracked
              }

              product {
                id
                title

                media(first: 1) {
                  nodes {
                    mediaContentType

                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                  }
                }
              }
            }
          }

          outOfStock: productVariants(
            first: 50
            query: "inventory_quantity:0 gift_card:false"
            sortKey: INVENTORY_QUANTITY
          ) {
            nodes {
              id
              title
              sku
              price
              inventoryQuantity

              inventoryItem {
                tracked
              }

              product {
                id
                title

                media(first: 1) {
                  nodes {
                    mediaContentType

                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
    );

    const result = await response.json();

    const lowStock =
      result.data?.lowStock?.nodes?.filter(
        (variant) => variant.inventoryItem?.tracked,
      ) || [];

    const outOfStock =
      result.data?.outOfStock?.nodes?.filter(
        (variant) => variant.inventoryItem?.tracked,
      ) || [];

    return {
      type: "stockAlerts",
      lowStock,
      outOfStock,
    };
  }

  // =====================================================
  // LIVE SEARCH
  // =====================================================

  if (intent === "suggestProducts") {
    const keyword =
      formData.get("keyword")?.trim() || "";

    if (keyword.length < 2) {
      return {
        type: "suggestProducts",
        products: [],
      };
    }

    const response = await admin.graphql(
      `#graphql
        query SuggestProducts($query: String) {
          products(
            first: 8
            query: $query
            sortKey: RELEVANCE
          ) {
            nodes {
              id
              title
              vendor
              productType

              media(first: 1) {
                nodes {
                  mediaContentType

                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }

              variants(first: 3) {
                nodes {
                  sku
                  price
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: keyword,
        },
      },
    );

    const result = await response.json();

    return {
      type: "suggestProducts",
      products:
        result.data?.products?.nodes || [],
    };
  }

  // =====================================================
  // SEARCH PRODUCTS
  // =====================================================

  if (intent === "searchProducts") {
    const searchTerm =
      formData.get("searchTerm")?.trim() || "";

    const response = await admin.graphql(
      `#graphql
        query SearchProducts($query: String) {
          products(
            first: 20
            query: $query
            sortKey: TITLE
          ) {
            nodes {
              id
              title
              vendor
              productType
              status

              media(first: 1) {
                nodes {
                  mediaContentType

                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }

              variants(first: 5) {
                nodes {
                  id
                  sku
                  price
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: searchTerm || null,
        },
      },
    );

    const result = await response.json();

    const products =
      result.data?.products?.nodes || [];

    return {
      type: "searchProducts",
      searchTerm,
      products,
      error:
        products.length === 0
          ? "No products found."
          : null,
    };
  }

  // =====================================================
  // LOAD PRODUCT
  // =====================================================

  if (intent === "loadProduct") {
    const productId =
      formData.get("productId");

    const response = await admin.graphql(
      `#graphql
        query LoadProduct($id: ID!) {
          product(id: $id) {
            id
            title
            descriptionHtml
            vendor
            productType
            tags
            status

            options {
              id
              name
              position

              optionValues {
                id
                name
              }
            }

            media(first: 20) {
              nodes {
                id
                alt
                mediaContentType

                ... on MediaImage {
                  image {
                    url
                  }
                }
              }
            }

            variants(first: 100) {
              nodes {
                id
                title
                sku
                price
                compareAtPrice

                selectedOptions {
                  name
                  value
                }

                inventoryItem {
                  id
                  tracked

                  inventoryLevels(first: 10) {
                    nodes {
                      location {
                        id
                        name
                      }

                      quantities(
                        names: ["available"]
                      ) {
                        name
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: productId,
        },
      },
    );

    const result = await response.json();

    return {
      type: "loadProduct",
      product:
        result.data?.product || null,
    };
  }

  // =====================================================
  // UPDATE PRODUCT
  // =====================================================

  if (intent === "updateProduct") {
    const productId =
      formData.get("productId");

    const tags = (
      formData.get("tags") || ""
    )
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const response = await admin.graphql(
      `#graphql
        mutation UpdateProduct(
          $product: ProductUpdateInput!
        ) {
          productUpdate(
            product: $product
          ) {
            product {
              id
              title
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          product: {
            id: productId,
            title:
              formData.get("title"),
            descriptionHtml:
              formData.get(
                "descriptionHtml",
              ),
            vendor:
              formData.get("vendor"),
            productType:
              formData.get(
                "productType",
              ),
            tags,
            status:
              formData.get("status"),
          },
        },
      },
    );

    const result = await response.json();

    const errors =
      result.data?.productUpdate
        ?.userErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Product updated successfully.",
    );
  }

  // =====================================================
  // CREATE VARIANT
  // =====================================================

  if (intent === "createVariant") {
    const productId =
      formData.get("productId");

    const price =
      formData.get("price")?.trim() || "";

    const sku =
      formData
        .get("newVariantSku")
        ?.trim() || "";

    const optionNames = JSON.parse(
      formData.get("optionNames") || "[]",
    );

    const optionValues =
      optionNames.map(
        (optionName, index) => ({
          optionName,
          name:
            formData
              .get(`option_${index}`)
              ?.trim() || "",
        }),
      );

    if (
      optionValues.some(
        (option) => !option.name,
      )
    ) {
      return simpleMutationError(
        productId,
        "Please enter every option value.",
      );
    }

    const newVariant = {
      optionValues,
    };

    if (sku) {
      newVariant.inventoryItem = {
        sku,
      };
    }

    if (price) {
      newVariant.price = price;
    }

    const response = await admin.graphql(
      `#graphql
        mutation CreateVariant(
          $productId: ID!
          $variants: [ProductVariantsBulkInput!]!
        ) {
          productVariantsBulkCreate(
            productId: $productId
            variants: $variants
          ) {
            productVariants {
              id
              title
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          productId,
          variants: [newVariant],
        },
      },
    );

    const result = await response.json();

    const errors =
      result.data
        ?.productVariantsBulkCreate
        ?.userErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Variant created successfully.",
    );
  }

  // =====================================================
  // UPDATE VARIANT
  // =====================================================

  if (intent === "updateVariant") {
    const productId =
      formData.get("productId");

    const variantId =
      formData.get("variantId");

    const sku =
      formData.get("sku")?.trim();

    const price =
      formData.get("price")?.trim();

    const compareAtPrice =
      formData
        .get("compareAtPrice")
        ?.trim();

    const variantInput = {
      id: variantId,
      compareAtPrice:
        compareAtPrice || null,
    };

    if (price) {
      variantInput.price = price;
    }

    if (sku) {
      variantInput.inventoryItem = {
        sku,
      };
    }

    const response = await admin.graphql(
      `#graphql
        mutation UpdateVariant(
          $productId: ID!
          $variants: [ProductVariantsBulkInput!]!
        ) {
          productVariantsBulkUpdate(
            productId: $productId
            variants: $variants
          ) {
            productVariants {
              id
              price
              compareAtPrice
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          productId,
          variants: [variantInput],
        },
      },
    );

    const result = await response.json();

    const errors =
      result.data
        ?.productVariantsBulkUpdate
        ?.userErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Variant updated.",
    );
  }

  // =====================================================
  // DELETE VARIANT
  // =====================================================

  if (intent === "deleteVariant") {
    const productId =
      formData.get("productId");

    const variantId =
      formData.get("variantId");

    const response = await admin.graphql(
      `#graphql
        mutation DeleteVariant(
          $productId: ID!
          $variantIds: [ID!]!
        ) {
          productVariantsBulkDelete(
            productId: $productId
            variantsIds: $variantIds
          ) {
            product {
              id
              title
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          productId,
          variantIds: [variantId],
        },
      },
    );

    const result = await response.json();

    const errors =
      result.data
        ?.productVariantsBulkDelete
        ?.userErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Variant deleted.",
    );
  }

  // =====================================================
  // UPDATE INVENTORY
  // =====================================================

  if (intent === "updateInventory") {
    const productId =
      formData.get("productId");

    const inventoryItemId =
      formData.get(
        "inventoryItemId",
      );

    const locationId =
      formData.get("locationId");

    const quantity = Number(
      formData.get("quantity"),
    );

    const oldQuantity = Number(
      formData.get("oldQuantity"),
    );

    if (
      Number.isNaN(quantity) ||
      Number.isNaN(oldQuantity)
    ) {
      return simpleMutationError(
        productId,
        "Invalid inventory quantity.",
      );
    }

    const response = await admin.graphql(
      `#graphql
        mutation UpdateInventory(
          $input: InventorySetQuantitiesInput!
          $idempotencyKey: String!
        ) {
          inventorySetQuantities(
            input: $input
          )
          @idempotent(
            key: $idempotencyKey
          ) {
            inventoryAdjustmentGroup {
              createdAt
              reason
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          idempotencyKey:
            randomUUID(),

          input: {
            name: "available",
            reason: "correction",

            quantities: [
              {
                inventoryItemId,
                locationId,
                quantity,
                changeFromQuantity:
                  oldQuantity,
              },
            ],
          },
        },
      },
    );

    const result = await response.json();

    const errors =
      result.data
        ?.inventorySetQuantities
        ?.userErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Inventory updated.",
    );
  }

  // =====================================================
  // UPLOAD IMAGE
  // =====================================================

  if (intent === "uploadImage") {
    const productId =
      formData.get("productId");

    const imageFile =
      formData.get("imageFile");

    const imageAlt =
      formData.get("imageAlt") || "";

    if (
      !imageFile ||
      typeof imageFile !== "object" ||
      !("size" in imageFile) ||
      imageFile.size === 0
    ) {
      return simpleMutationError(
        productId,
        "Choose an image first.",
      );
    }

    if (
      !imageFile.type?.startsWith(
        "image/",
      )
    ) {
      return simpleMutationError(
        productId,
        "Only image files are allowed.",
      );
    }

    const stagedResponse =
      await admin.graphql(
        `#graphql
          mutation StageUpload(
            $input: [StagedUploadInput!]!
          ) {
            stagedUploadsCreate(
              input: $input
            ) {
              stagedTargets {
                url
                resourceUrl

                parameters {
                  name
                  value
                }
              }

              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            input: [
              {
                resource: "IMAGE",
                filename:
                  imageFile.name,
                mimeType:
                  imageFile.type,
                httpMethod: "POST",
              },
            ],
          },
        },
      );

    const staged =
      await stagedResponse.json();

    const stageErrors =
      staged.data
        ?.stagedUploadsCreate
        ?.userErrors || [];

    if (stageErrors.length) {
      return mutationError(
        productId,
        stageErrors,
      );
    }

    const target =
      staged.data
        ?.stagedUploadsCreate
        ?.stagedTargets?.[0];

    if (!target) {
      return simpleMutationError(
        productId,
        "Upload target not returned.",
      );
    }

    const uploadForm =
      new FormData();

    target.parameters.forEach(
      (parameter) => {
        uploadForm.append(
          parameter.name,
          parameter.value,
        );
      },
    );

    uploadForm.append(
      "file",
      imageFile,
      imageFile.name,
    );

    const uploadResponse =
      await fetch(target.url, {
        method: "POST",
        body: uploadForm,
      });

    if (!uploadResponse.ok) {
      return simpleMutationError(
        productId,
        "Image upload failed.",
      );
    }

    const attachResponse =
      await admin.graphql(
        `#graphql
          mutation AddProductMedia(
            $product: ProductUpdateInput!
            $media: [CreateMediaInput!]
          ) {
            productUpdate(
              product: $product
              media: $media
            ) {
              product {
                id
              }

              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            product: {
              id: productId,
            },

            media: [
              {
                originalSource:
                  target.resourceUrl,
                alt: imageAlt,
                mediaContentType:
                  "IMAGE",
              },
            ],
          },
        },
      );

    const attached =
      await attachResponse.json();

    const errors =
      attached.data?.productUpdate
        ?.userErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Image uploaded.",
    );
  }

  // =====================================================
  // DELETE IMAGE
  // =====================================================

  if (intent === "deleteImage") {
    const productId =
      formData.get("productId");

    const mediaId =
      formData.get("mediaId");

    const response = await admin.graphql(
      `#graphql
        mutation DeleteMedia(
          $productId: ID!
          $mediaIds: [ID!]!
        ) {
          productDeleteMedia(
            productId: $productId
            mediaIds: $mediaIds
          ) {
            deletedMediaIds

            mediaUserErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          productId,
          mediaIds: [mediaId],
        },
      },
    );

    const result = await response.json();

    const errors =
      result.data
        ?.productDeleteMedia
        ?.mediaUserErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Image deleted.",
    );
  }

  // =====================================================
  // REORDER IMAGE
  // =====================================================

  if (intent === "moveImage") {
    const productId =
      formData.get("productId");

    const mediaId =
      formData.get("mediaId");

    const newPosition =
      formData.get("newPosition");

    const response = await admin.graphql(
      `#graphql
        mutation ReorderMedia(
          $id: ID!
          $moves: [MoveInput!]!
        ) {
          productReorderMedia(
            id: $id
            moves: $moves
          ) {
            job {
              id
              done
            }

            mediaUserErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id: productId,

          moves: [
            {
              id: mediaId,
              newPosition,
            },
          ],
        },
      },
    );

    const result = await response.json();

    const errors =
      result.data
        ?.productReorderMedia
        ?.mediaUserErrors || [];

    if (errors.length) {
      return mutationError(
        productId,
        errors,
      );
    }

    return mutationSuccess(
      productId,
      "Image order updated.",
    );
  }

  return {
    type: "mutation",
    success: false,
    error: "Unknown action.",
    requestId: randomUUID(),
  };
};

// =========================================================
// HELPERS
// =========================================================

function mutationSuccess(
  productId,
  message,
) {
  return {
    type: "mutation",
    success: true,
    productId,
    message,
    requestId: randomUUID(),
  };
}

function mutationError(
  productId,
  errors,
) {
  return {
    type: "mutation",
    success: false,
    productId,
    error: errors
      .map((error) => error.message)
      .join(", "),
    requestId: randomUUID(),
  };
}

function simpleMutationError(
  productId,
  message,
) {
  return {
    type: "mutation",
    success: false,
    productId,
    error: message,
    requestId: randomUUID(),
  };
}

// =========================================================
// PAGE
// =========================================================

export default function Index() {
  const searchFetcher =
    useFetcher();

  const suggestFetcher =
    useFetcher();

  const productFetcher =
    useFetcher();

  const mutationFetcher =
    useFetcher();

  const stockFetcher =
    useFetcher();

  const lastRefreshId =
    useRef(null);

  const [
    searchText,
    setSearchText,
  ] = useState("");

  const [
    showSuggestions,
    setShowSuggestions,
  ] = useState(false);

  const [
    lastAction,
    setLastAction,
  ] = useState(null);

  // =====================================================
  // DATA
  // =====================================================

  const suggestions =
    suggestFetcher.data?.type ===
    "suggestProducts"
      ? suggestFetcher.data
          .products || []
      : [];

  const products =
    searchFetcher.data?.type ===
    "searchProducts"
      ? searchFetcher.data
          .products || []
      : [];

  const lowStock =
    stockFetcher.data?.type ===
    "stockAlerts"
      ? stockFetcher.data
          .lowStock || []
      : [];

  const outOfStock =
    stockFetcher.data?.type ===
    "stockAlerts"
      ? stockFetcher.data
          .outOfStock || []
      : [];

  const product =
    productFetcher.data?.type ===
    "loadProduct"
      ? productFetcher.data
          .product
      : null;

  const variants =
    product?.variants?.nodes || [];

  const options =
    product?.options || [];

  const images =
    product?.media?.nodes
      ?.filter(
        (media) =>
          media.mediaContentType ===
          "IMAGE",
      ) || [];

  const saving =
    mutationFetcher.state !==
    "idle";

  const suggesting =
    suggestFetcher.state !==
    "idle";

  const searching =
    searchFetcher.state !==
    "idle";

  const loadingProduct =
    productFetcher.state !==
    "idle";

  // =====================================================
  // ACTIVE MUTATION
  // =====================================================

  function activeMutation(
    intent,
    fieldName,
    fieldValue,
  ) {
    if (
      mutationFetcher.state ===
      "idle"
    ) {
      return false;
    }

    const submitted =
      mutationFetcher.formData;

    if (!submitted) {
      return false;
    }

    if (
      submitted.get("intent") !==
      intent
    ) {
      return false;
    }

    if (
      fieldName &&
      submitted.get(fieldName) !==
        fieldValue
    ) {
      return false;
    }

    return true;
  }

  function rememberAction(
    intent,
    targetId,
  ) {
    setLastAction({
      intent,
      targetId,
    });
  }

  function InlineResult({
    intent,
    targetId,
  }) {
    if (
      mutationFetcher.state !==
        "idle" ||
      mutationFetcher.data?.type !==
        "mutation" ||
      lastAction?.intent !== intent ||
      lastAction?.targetId !==
        targetId
    ) {
      return null;
    }

    const success =
      mutationFetcher.data.success;

    return (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "8px",
          background: success
            ? "#ecfdf3"
            : "#fef3f2",
          border: success
            ? "1px solid #abefc6"
            : "1px solid #fecdca",
          color: success
            ? "#067647"
            : "#b42318",
          fontWeight: 600,
        }}
      >
        {success
          ? `✓ ${mutationFetcher.data.message}`
          : `Error: ${mutationFetcher.data.error}`}
      </div>
    );
  }

  // =====================================================
  // INITIAL STOCK LOAD
  // =====================================================

  useEffect(() => {
    stockFetcher.submit(
      {
        intent: "stockAlerts",
      },
      {
        method: "post",
      },
    );
  }, []);

  // =====================================================
  // LIVE SEARCH
  // =====================================================

  useEffect(() => {
    const keyword =
      searchText.trim();

    if (keyword.length < 2) {
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(
      () => {
        suggestFetcher.submit(
          {
            intent:
              "suggestProducts",
            keyword,
          },
          {
            method: "post",
          },
        );

        setShowSuggestions(true);
      },
      300,
    );

    return () =>
      clearTimeout(timer);
  }, [searchText]);

  // =====================================================
  // REFRESH AFTER MUTATION
  // =====================================================

  useEffect(() => {
    const data =
      mutationFetcher.data;

    if (
      mutationFetcher.state !==
        "idle" ||
      !data?.success ||
      !data?.productId ||
      !data?.requestId
    ) {
      return;
    }

    if (
      lastRefreshId.current ===
      data.requestId
    ) {
      return;
    }

    lastRefreshId.current =
      data.requestId;

    productFetcher.submit(
      {
        intent: "loadProduct",
        productId:
          data.productId,
      },
      {
        method: "post",
      },
    );

    stockFetcher.submit(
      {
        intent: "stockAlerts",
      },
      {
        method: "post",
      },
    );
  }, [
    mutationFetcher.state,
    mutationFetcher.data,
  ]);

  // =====================================================
  // STYLES
  // =====================================================

  const card = {
    background: "#fff",
    border:
      "1px solid #ddd",
    borderRadius: "12px",
    padding: "18px",
    display: "grid",
    gap: "14px",
  };

  const field = {
    width: "100%",
    padding:
      "10px 12px",
    border:
      "1px solid #bbb",
    borderRadius: "8px",
    boxSizing:
      "border-box",
  };

  const label = {
    display: "grid",
    gap: "6px",
    fontWeight: 600,
  };

  const button = {
    padding:
      "9px 14px",
    border:
      "1px solid #999",
    borderRadius: "8px",
    background: "#fff",
    cursor: "pointer",
  };

  const dangerButton = {
    ...button,
    border:
      "1px solid #cc0000",
    color: "#b42318",
  };

  const grid = {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "14px",
  };

  // =====================================================
  // OPEN PRODUCT
  // =====================================================

  function openProduct(
    productId,
  ) {
    setShowSuggestions(false);
    setLastAction(null);

    productFetcher.submit(
      {
        intent: "loadProduct",
        productId,
      },
      {
        method: "post",
      },
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  // =====================================================
  // SEARCH
  // =====================================================

  function runSearch() {
    setShowSuggestions(false);

    searchFetcher.submit(
      {
        intent: "searchProducts",
        searchTerm: searchText,
      },
      {
        method: "post",
      },
    );
  }

  // =====================================================
  // STOCK CARD
  // =====================================================

  function StockCard({
    item,
    status,
  }) {
    const image =
      item.product?.media
        ?.nodes?.[0]
        ?.image?.url;

    const productTitle =
      item.product?.title ||
      "Unknown Product";

    const showVariantTitle =
      item.title &&
      item.title !==
        "Default Title";

    return (
      <div style={card}>
        <div
          style={{
            display: "flex",
            gap: "12px",
          }}
        >
          {image ? (
            <img
              src={image}
              alt={productTitle}
              style={{
                width: "70px",
                height: "70px",
                objectFit:
                  "cover",
                borderRadius:
                  "8px",
              }}
            />
          ) : (
            <div
              style={{
                width: "70px",
                height: "70px",
                background:
                  "#f3f3f3",
                borderRadius:
                  "8px",
              }}
            />
          )}

          <div
            style={{
              display: "grid",
              gap: "4px",
            }}
          >
            <strong>
              {productTitle}
            </strong>

            {showVariantTitle && (
              <div>
                Variant:{" "}
                {item.title}
              </div>
            )}

            <div>
              Stock:{" "}
              <strong>
                {
                  item.inventoryQuantity
                }
              </strong>
            </div>

            <div
              style={{
                fontWeight: 600,
                color:
                  status ===
                  "Out of Stock"
                    ? "#b42318"
                    : "#b54708",
              }}
            >
              {status}
            </div>

            {item.sku && (
              <div>
                SKU: {item.sku}
              </div>
            )}
          </div>
        </div>

        <button
          style={button}
          type="button"
          onClick={() =>
            openProduct(
              item.product.id,
            )
          }
        >
          Edit Product
        </button>
      </div>
    );
  }

  // =====================================================
  // UI
  // =====================================================

  return (
    <s-page heading="Product Manager">

      {/* =================================================
          SEARCH
      ================================================== */}

      <s-section heading="Find Products">
        <div
          style={{
            display: "grid",
            gap: "16px",
          }}
        >
          <label style={label}>
            Search Product

            <input
              style={{
                ...field,
                padding:
                  "13px 14px",
                fontSize:
                  "16px",
              }}
              value={searchText}
              onChange={(event) =>
                setSearchText(
                  event.target.value,
                )
              }
              onFocus={() => {
                if (
                  searchText
                    .trim()
                    .length >= 2
                ) {
                  setShowSuggestions(
                    true,
                  );
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.key ===
                  "Enter"
                ) {
                  event.preventDefault();
                  runSearch();
                }

                if (
                  event.key ===
                  "Escape"
                ) {
                  setShowSuggestions(
                    false,
                  );
                }
              }}
              placeholder="Search title, SKU, vendor or product type"
              autoComplete="off"
            />
          </label>

          {showSuggestions &&
            searchText
              .trim()
              .length >= 2 && (
              <div
                style={{
                  minHeight:
                    "260px",
                  maxHeight:
                    "520px",
                  overflowY:
                    "auto",
                  border:
                    "1px solid #ddd",
                  borderRadius:
                    "12px",
                  background:
                    "#fff",
                }}
              >
                {suggesting && (
                  <div
                    style={{
                      padding:
                        "20px",
                    }}
                  >
                    Searching...
                  </div>
                )}

                {!suggesting &&
                  suggestions.length ===
                    0 && (
                    <div
                      style={{
                        padding:
                          "20px",
                      }}
                    >
                      No matching
                      products.
                    </div>
                  )}

                {!suggesting &&
                  suggestions.map(
                    (item) => {
                      const image =
                        item.media
                          ?.nodes?.[0]
                          ?.image?.url;

                      const variant =
                        item.variants
                          ?.nodes?.[0];

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() =>
                            openProduct(
                              item.id,
                            )
                          }
                          style={{
                            width:
                              "100%",
                            minHeight:
                              "80px",
                            border:
                              "none",
                            borderBottom:
                              "1px solid #eee",
                            background:
                              "#fff",
                            padding:
                              "12px",
                            display:
                              "flex",
                            gap:
                              "12px",
                            alignItems:
                              "center",
                            textAlign:
                              "left",
                            cursor:
                              "pointer",
                          }}
                        >
                          {image && (
                            <img
                              src={image}
                              alt={
                                item.title
                              }
                              style={{
                                width:
                                  "60px",
                                height:
                                  "60px",
                                objectFit:
                                  "cover",
                                borderRadius:
                                  "8px",
                              }}
                            />
                          )}

                          <div>
                            <strong>
                              {
                                item.title
                              }
                            </strong>

                            {variant?.sku && (
                              <div>
                                SKU:{" "}
                                {
                                  variant.sku
                                }
                              </div>
                            )}

                            {variant?.price && (
                              <div>
                                Price:{" "}
                                {
                                  variant.price
                                }
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    },
                  )}
              </div>
            )}

          <button
            style={button}
            type="button"
            onClick={runSearch}
            disabled={searching}
          >
            {searching
              ? "Searching..."
              : "Search Products"}
          </button>
        </div>
      </s-section>

      {/* =================================================
          LOADING PRODUCT
      ================================================== */}

      {loadingProduct && (
        <s-section>
          <div style={card}>
            Loading product...
          </div>
        </s-section>
      )}

      {/* =================================================
          PRODUCT EDITOR
      ================================================== */}

      {product && (
        <>
          <s-section heading="Editing Product">
            <div style={card}>
              <h2
                style={{
                  margin: 0,
                }}
              >
                {product.title}
              </h2>
            </div>
          </s-section>

          {/* =============================================
              PRODUCT INFO
          ============================================== */}

          <s-section heading="Product Information">
            <mutationFetcher.Form
              method="POST"
              onSubmit={() =>
                rememberAction(
                  "updateProduct",
                  product.id,
                )
              }
            >
              <div style={card}>
                <input
                  type="hidden"
                  name="intent"
                  value="updateProduct"
                />

                <input
                  type="hidden"
                  name="productId"
                  value={
                    product.id
                  }
                />

                <label style={label}>
                  Title

                  <input
                    style={field}
                    name="title"
                    defaultValue={
                      product.title
                    }
                  />
                </label>

                <label style={label}>
                  Description

                  <textarea
                    style={{
                      ...field,
                      minHeight:
                        "130px",
                    }}
                    name="descriptionHtml"
                    defaultValue={
                      product.descriptionHtml
                    }
                  />
                </label>

                <label style={label}>
                  Vendor

                  <input
                    style={field}
                    name="vendor"
                    defaultValue={
                      product.vendor
                    }
                  />
                </label>

                <label style={label}>
                  Product Type

                  <input
                    style={field}
                    name="productType"
                    defaultValue={
                      product.productType
                    }
                  />
                </label>

                <label style={label}>
                  Tags

                  <input
                    style={field}
                    name="tags"
                    defaultValue={
                      product.tags.join(
                        ", ",
                      )
                    }
                  />
                </label>

                <label style={label}>
                  Status

                  <select
                    style={field}
                    name="status"
                    defaultValue={
                      product.status
                    }
                  >
                    <option value="ACTIVE">
                      Active
                    </option>

                    <option value="DRAFT">
                      Draft
                    </option>

                    <option value="ARCHIVED">
                      Archived
                    </option>

                    <option value="UNLISTED">
                      Unlisted
                    </option>
                  </select>
                </label>

                <button
                  style={button}
                  type="submit"
                  disabled={saving}
                >
                  {activeMutation(
                    "updateProduct",
                  )
                    ? "Saving Product..."
                    : "Save Product"}
                </button>

                <InlineResult
                  intent="updateProduct"
                  targetId={
                    product.id
                  }
                />
              </div>
            </mutationFetcher.Form>
          </s-section>

          {/* =============================================
              CREATE VARIANT
          ============================================== */}

          {options.length >
            0 && (
            <s-section heading="Create New Variant">
              <mutationFetcher.Form
                method="POST"
                onSubmit={() =>
                  rememberAction(
                    "createVariant",
                    product.id,
                  )
                }
              >
                <div style={card}>
                  <input
                    type="hidden"
                    name="intent"
                    value="createVariant"
                  />

                  <input
                    type="hidden"
                    name="productId"
                    value={
                      product.id
                    }
                  />

                  <input
                    type="hidden"
                    name="optionNames"
                    value={JSON.stringify(
                      options.map(
                        (option) =>
                          option.name,
                      ),
                    )}
                  />

                  {options.map(
                    (
                      option,
                      index,
                    ) => (
                      <label
                        key={
                          option.id
                        }
                        style={label}
                      >
                        {
                          option.name
                        }

                        <input
                          style={field}
                          name={`option_${index}`}
                          placeholder={`Enter ${option.name}`}
                          list={`option-list-${option.id}`}
                        />

                        <datalist
                          id={`option-list-${option.id}`}
                        >
                          {option.optionValues.map(
                            (
                              value,
                            ) => (
                              <option
                                key={
                                  value.id
                                }
                                value={
                                  value.name
                                }
                              />
                            ),
                          )}
                        </datalist>
                      </label>
                    ),
                  )}

                  <label style={label}>
                    SKU

                    <input
                      style={field}
                      name="newVariantSku"
                    />
                  </label>

                  <label style={label}>
                    Price

                    <input
                      style={field}
                      name="price"
                      type="number"
                      step="0.01"
                      min="0"
                    />
                  </label>

                  <button
                    style={button}
                    type="submit"
                    disabled={saving}
                  >
                    {activeMutation(
                      "createVariant",
                    )
                      ? "Creating Variant..."
                      : "Create Variant"}
                  </button>

                  <InlineResult
                    intent="createVariant"
                    targetId={
                      product.id
                    }
                  />
                </div>
              </mutationFetcher.Form>
            </s-section>
          )}

          {/* =============================================
              VARIANTS
          ============================================== */}

          <s-section heading="Variants & Inventory">
            <div
              style={{
                display: "grid",
                gap: "18px",
              }}
            >
              <InlineResult
                intent="deleteVariant"
                targetId={
                  product.id
                }
              />

              {variants.map(
                (variant) => (
                  <div
                    key={
                      variant.id
                    }
                    style={card}
                  >
                    <h3
                      style={{
                        margin: 0,
                      }}
                    >
                      {
                        variant.title
                      }
                    </h3>

                    {variant.selectedOptions?.map(
                      (option) => (
                        <div
                          key={
                            option.name
                          }
                        >
                          <strong>
                            {
                              option.name
                            }
                            :
                          </strong>{" "}
                          {
                            option.value
                          }
                        </div>
                      ),
                    )}

                    {/* UPDATE VARIANT */}

                    <mutationFetcher.Form
                      method="POST"
                      onSubmit={() =>
                        rememberAction(
                          "updateVariant",
                          variant.id,
                        )
                      }
                    >
                      <div
                        style={{
                          display:
                            "grid",
                          gap: "10px",
                        }}
                      >
                        <input
                          type="hidden"
                          name="intent"
                          value="updateVariant"
                        />

                        <input
                          type="hidden"
                          name="productId"
                          value={
                            product.id
                          }
                        />

                        <input
                          type="hidden"
                          name="variantId"
                          value={
                            variant.id
                          }
                        />

                        <label style={label}>
                          SKU

                          <input
                            style={
                              field
                            }
                            name="sku"
                            defaultValue={
                              variant.sku ||
                              ""
                            }
                          />
                        </label>

                        <label style={label}>
                          Price

                          <input
                            style={
                              field
                            }
                            name="price"
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={
                              variant.price
                            }
                          />
                        </label>

                        <label style={label}>
                          Compare Price

                          <input
                            style={
                              field
                            }
                            name="compareAtPrice"
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={
                              variant.compareAtPrice ||
                              ""
                            }
                          />
                        </label>

                        <button
                          style={
                            button
                          }
                          type="submit"
                          disabled={
                            saving
                          }
                        >
                          {activeMutation(
                            "updateVariant",
                            "variantId",
                            variant.id,
                          )
                            ? "Saving Variant..."
                            : "Save Variant"}
                        </button>

                        <InlineResult
                          intent="updateVariant"
                          targetId={
                            variant.id
                          }
                        />
                      </div>
                    </mutationFetcher.Form>

                    {/* INVENTORY OFF */}

                    {!variant
                      .inventoryItem
                      ?.tracked && (
                      <div
                        style={{
                          padding:
                            "12px",
                          background:
                            "#f7f7f7",
                          borderRadius:
                            "8px",
                        }}
                      >
                        Inventory
                        tracking is
                        disabled for
                        this variant.
                      </div>
                    )}

                    {/* INVENTORY */}

                    {variant
                      .inventoryItem
                      ?.tracked &&
                      (
                        variant
                          .inventoryItem
                          ?.inventoryLevels
                          ?.nodes || []
                      ).map(
                        (level) => {
                          const current =
                            level.quantities.find(
                              (
                                quantity,
                              ) =>
                                quantity.name ===
                                "available",
                            )
                              ?.quantity ??
                            0;

                          const inventoryTarget =
                            `${variant.inventoryItem.id}:${level.location.id}`;

                          return (
                            <mutationFetcher.Form
                              key={
                                level
                                  .location
                                  .id
                              }
                              method="POST"
                              onSubmit={() =>
                                rememberAction(
                                  "updateInventory",
                                  inventoryTarget,
                                )
                              }
                            >
                              <div
                                style={{
                                  display:
                                    "grid",
                                  gap:
                                    "10px",
                                  padding:
                                    "14px",
                                  background:
                                    "#f7f7f7",
                                  borderRadius:
                                    "8px",
                                }}
                              >
                                <input
                                  type="hidden"
                                  name="intent"
                                  value="updateInventory"
                                />

                                <input
                                  type="hidden"
                                  name="productId"
                                  value={
                                    product.id
                                  }
                                />

                                <input
                                  type="hidden"
                                  name="inventoryItemId"
                                  value={
                                    variant
                                      .inventoryItem
                                      .id
                                  }
                                />

                                <input
                                  type="hidden"
                                  name="locationId"
                                  value={
                                    level
                                      .location
                                      .id
                                  }
                                />

                                <input
                                  type="hidden"
                                  name="oldQuantity"
                                  value={
                                    current
                                  }
                                />

                                <strong>
                                  {
                                    level
                                      .location
                                      .name
                                  }
                                </strong>

                                <div>
                                  Current
                                  Stock:{" "}
                                  <strong>
                                    {
                                      current
                                    }
                                  </strong>
                                </div>

                                <label
                                  style={
                                    label
                                  }
                                >
                                  New
                                  Quantity

                                  <input
                                    style={
                                      field
                                    }
                                    type="number"
                                    name="quantity"
                                    defaultValue={
                                      current
                                    }
                                  />
                                </label>

                                <button
                                  style={
                                    button
                                  }
                                  type="submit"
                                  disabled={
                                    saving
                                  }
                                >
                                  {activeMutation(
                                    "updateInventory",
                                    "locationId",
                                    level
                                      .location
                                      .id,
                                  )
                                    ? "Updating Stock..."
                                    : "Update Inventory"}
                                </button>

                                <InlineResult
                                  intent="updateInventory"
                                  targetId={
                                    inventoryTarget
                                  }
                                />
                              </div>
                            </mutationFetcher.Form>
                          );
                        },
                      )}

                    {/* DELETE VARIANT */}

                    {variants.length >
                      1 && (
                      <mutationFetcher.Form
                        method="POST"
                        onSubmit={(
                          event,
                        ) => {
                          const confirmed =
                            window.confirm(
                              `Delete variant "${variant.title}"?\n\nThis action cannot be undone.`,
                            );

                          if (
                            !confirmed
                          ) {
                            event.preventDefault();
                            return;
                          }

                          rememberAction(
                            "deleteVariant",
                            product.id,
                          );
                        }}
                      >
                        <input
                          type="hidden"
                          name="intent"
                          value="deleteVariant"
                        />

                        <input
                          type="hidden"
                          name="productId"
                          value={
                            product.id
                          }
                        />

                        <input
                          type="hidden"
                          name="variantId"
                          value={
                            variant.id
                          }
                        />

                        <button
                          style={
                            dangerButton
                          }
                          type="submit"
                          disabled={
                            saving
                          }
                        >
                          {activeMutation(
                            "deleteVariant",
                            "variantId",
                            variant.id,
                          )
                            ? "Deleting Variant..."
                            : "Delete Variant"}
                        </button>
                      </mutationFetcher.Form>
                    )}
                  </div>
                ),
              )}
            </div>
          </s-section>

          {/* =============================================
              PRODUCT IMAGES
          ============================================== */}

          <s-section heading="Product Images">
            <div style={card}>

              <InlineResult
                intent="deleteImage"
                targetId={
                  product.id
                }
              />

              <InlineResult
                intent="moveImage"
                targetId={
                  product.id
                }
              />

              {images.length ===
                0 && (
                <div>
                  No product images.
                </div>
              )}

              {images.map(
                (
                  media,
                  index,
                ) => (
                  <div
                    key={media.id}
                    style={{
                      display:
                        "flex",
                      gap: "14px",
                      alignItems:
                        "center",
                      flexWrap:
                        "wrap",
                      paddingBottom:
                        "14px",
                      borderBottom:
                        "1px solid #eee",
                    }}
                  >
                    {media.image
                      ?.url && (
                      <img
                        src={
                          media.image
                            .url
                        }
                        alt={
                          media.alt ||
                          ""
                        }
                        style={{
                          width:
                            "120px",
                          height:
                            "120px",
                          objectFit:
                            "cover",
                          borderRadius:
                            "8px",
                        }}
                      />
                    )}

                    <div
                      style={{
                        minWidth:
                          "140px",
                      }}
                    >
                      <strong>
                        Image{" "}
                        {index + 1}
                      </strong>

                      <div>
                        {media.alt ||
                          "No alt text"}
                      </div>
                    </div>

                    {/* LEFT */}

                    {index > 0 && (
                      <mutationFetcher.Form
                        method="POST"
                        onSubmit={() =>
                          rememberAction(
                            "moveImage",
                            product.id,
                          )
                        }
                      >
                        <input
                          type="hidden"
                          name="intent"
                          value="moveImage"
                        />

                        <input
                          type="hidden"
                          name="productId"
                          value={
                            product.id
                          }
                        />

                        <input
                          type="hidden"
                          name="mediaId"
                          value={
                            media.id
                          }
                        />

                        <input
                          type="hidden"
                          name="newPosition"
                          value={String(
                            index - 1,
                          )}
                        />

                        <button
                          style={button}
                          type="submit"
                          disabled={
                            saving
                          }
                        >
                          {activeMutation(
                            "moveImage",
                            "mediaId",
                            media.id,
                          )
                            ? "..."
                            : "←"}
                        </button>
                      </mutationFetcher.Form>
                    )}

                    {/* RIGHT */}

                    {index <
                      images.length -
                        1 && (
                      <mutationFetcher.Form
                        method="POST"
                        onSubmit={() =>
                          rememberAction(
                            "moveImage",
                            product.id,
                          )
                        }
                      >
                        <input
                          type="hidden"
                          name="intent"
                          value="moveImage"
                        />

                        <input
                          type="hidden"
                          name="productId"
                          value={
                            product.id
                          }
                        />

                        <input
                          type="hidden"
                          name="mediaId"
                          value={
                            media.id
                          }
                        />

                        <input
                          type="hidden"
                          name="newPosition"
                          value={String(
                            index + 1,
                          )}
                        />

                        <button
                          style={button}
                          type="submit"
                          disabled={
                            saving
                          }
                        >
                          {activeMutation(
                            "moveImage",
                            "mediaId",
                            media.id,
                          )
                            ? "..."
                            : "→"}
                        </button>
                      </mutationFetcher.Form>
                    )}

                    {/* DELETE IMAGE */}

                    <mutationFetcher.Form
                      method="POST"
                      onSubmit={(
                        event,
                      ) => {
                        const confirmed =
                          window.confirm(
                            `Delete Image ${index + 1}?\n\nThis image will be removed from the product.`,
                          );

                        if (
                          !confirmed
                        ) {
                          event.preventDefault();
                          return;
                        }

                        rememberAction(
                          "deleteImage",
                          product.id,
                        );
                      }}
                    >
                      <input
                        type="hidden"
                        name="intent"
                        value="deleteImage"
                      />

                      <input
                        type="hidden"
                        name="productId"
                        value={
                          product.id
                        }
                      />

                      <input
                        type="hidden"
                        name="mediaId"
                        value={
                          media.id
                        }
                      />

                      <button
                        style={
                          dangerButton
                        }
                        type="submit"
                        disabled={
                          saving
                        }
                      >
                        {activeMutation(
                          "deleteImage",
                          "mediaId",
                          media.id,
                        )
                          ? "Deleting Image..."
                          : "Delete Image"}
                      </button>
                    </mutationFetcher.Form>
                  </div>
                ),
              )}

              {/* UPLOAD IMAGE */}

              <mutationFetcher.Form
                method="POST"
                encType="multipart/form-data"
                onSubmit={() =>
                  rememberAction(
                    "uploadImage",
                    product.id,
                  )
                }
              >
                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <input
                    type="hidden"
                    name="intent"
                    value="uploadImage"
                  />

                  <input
                    type="hidden"
                    name="productId"
                    value={
                      product.id
                    }
                  />

                  <label style={label}>
                    Upload Image

                    <input
                      style={field}
                      type="file"
                      name="imageFile"
                      accept="image/*"
                    />
                  </label>

                  <label style={label}>
                    Alt Text

                    <input
                      style={field}
                      name="imageAlt"
                    />
                  </label>

                  <button
                    style={button}
                    type="submit"
                    disabled={saving}
                  >
                    {activeMutation(
                      "uploadImage",
                    )
                      ? "Uploading Image..."
                      : "Upload Image"}
                  </button>

                  <InlineResult
                    intent="uploadImage"
                    targetId={
                      product.id
                    }
                  />
                </div>
              </mutationFetcher.Form>
            </div>
          </s-section>
        </>
      )}

      {/* =================================================
          INVENTORY ALERTS
      ================================================== */}

      <s-section heading="Inventory Alerts">

        <div
          style={{
            marginBottom:
              "28px",
          }}
        >
          <h3>
            ⚠ Low Stock (
            {lowStock.length})
          </h3>

          <p
            style={{
              color: "#666",
            }}
          >
            Variants with 1 to 5
            units remaining.
          </p>

          {lowStock.length ===
          0 ? (
            <div style={card}>
              No low-stock
              variants.
            </div>
          ) : (
            <div style={grid}>
              {lowStock.map(
                (item) => (
                  <StockCard
                    key={item.id}
                    item={item}
                    status="Low Stock"
                  />
                ),
              )}
            </div>
          )}
        </div>

        <div>
          <h3>
            ● Out of Stock (
            {outOfStock.length})
          </h3>

          <p
            style={{
              color: "#666",
            }}
          >
            Tracked variants with
            zero inventory.
          </p>

          {outOfStock.length ===
          0 ? (
            <div style={card}>
              No out-of-stock
              variants.
            </div>
          ) : (
            <div style={grid}>
              {outOfStock.map(
                (item) => (
                  <StockCard
                    key={item.id}
                    item={item}
                    status="Out of Stock"
                  />
                ),
              )}
            </div>
          )}
        </div>
      </s-section>

      {/* =================================================
          SEARCH ERROR
      ================================================== */}

      {searchFetcher.data
        ?.error && (
        <s-section>
          <div style={card}>
            {
              searchFetcher.data
                .error
            }
          </div>
        </s-section>
      )}

      {/* =================================================
          SEARCH RESULTS
      ================================================== */}

      {products.length >
        0 && (
        <s-section heading="Search Results">
          <div style={grid}>
            {products.map(
              (item) => {
                const image =
                  item.media
                    ?.nodes?.[0]
                    ?.image?.url;

                const firstVariant =
                  item.variants
                    ?.nodes?.[0];

                const skus =
                  item.variants
                    ?.nodes
                    ?.map(
                      (variant) =>
                        variant.sku,
                    )
                    .filter(
                      Boolean,
                    ) || [];

                return (
                  <div
                    key={item.id}
                    style={card}
                  >
                    {image ? (
                      <img
                        src={image}
                        alt={
                          item.title
                        }
                        style={{
                          width:
                            "100%",
                          height:
                            "180px",
                          objectFit:
                            "cover",
                          borderRadius:
                            "8px",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height:
                            "180px",
                          background:
                            "#f3f3f3",
                          borderRadius:
                            "8px",
                          display:
                            "flex",
                          alignItems:
                            "center",
                          justifyContent:
                            "center",
                        }}
                      >
                        No Image
                      </div>
                    )}

                    <strong>
                      {item.title}
                    </strong>

                    <div>
                      Vendor:{" "}
                      {item.vendor ||
                        "—"}
                    </div>

                    <div>
                      Type:{" "}
                      {item.productType ||
                        "—"}
                    </div>

                    <div>
                      Status:{" "}
                      {item.status}
                    </div>

                    <div>
                      SKU:{" "}
                      {skus.length
                        ? skus.join(
                            ", ",
                          )
                        : "No SKU"}
                    </div>

                    {firstVariant
                      ?.price && (
                      <div>
                        Price:{" "}
                        {
                          firstVariant.price
                        }
                      </div>
                    )}

                    <button
                      style={button}
                      type="button"
                      onClick={() =>
                        openProduct(
                          item.id,
                        )
                      }
                    >
                      Edit Product
                    </button>
                  </div>
                );
              },
            )}
          </div>
        </s-section>
      )}
    </s-page>
  );
}