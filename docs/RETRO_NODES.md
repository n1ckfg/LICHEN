## **UI Design Tokens for a Modern Retro-Node Interface**

| Element | Amiga (MUI / MagicWB) Specification | C / Win32 (Win95 / NT 4.0) Specification | Modern Node Graph Application |
| :---- | :---- | :---- | :---- |
| **Canvas Background** | Checkerboard 1px dither (\#777777 & \#959595) | Solid Teal (\#008080) or AppWorkspace (\#808080) | Replace smooth dot grids with a subtle 2x2 pixel checkerboard dither that locks to integer zoom levels. |
| **Node Surface** | Warm Stone Gray (\#959595) or Mauve (\#A895A8) | Classic ButtonFace Gray (\#C0C0C0 or \#D4D0C8) | Flat matte fill with zero alpha transparency or blur; keeps overlapping nodes 100% readable. |
| **Border & Bevel** | 2px asymmetric ratio (1px wide top/left, 2px wide left/right to match non-square CRT pixels) | 2px nested bevel: Outer \#FFFFFF / \#000000, Inner \#DFDFDF / \#808080 | Use **raised bevels** for unselected nodes, **inverted/sunken bevels** while dragging, and **chiseled grooves** to separate parameter groups. |
| **Header Bar** | Horizontal dithered stripes inside the drag bar (=== drag ridges) | Navy (\#000080) active, Dark Gray (\#808080) inactive | Render tactile horizontal grip ridges inside the node header that highlight on hover. |
| **Port / Pin Sockets** | Square 6x6px sunken wells with a 2px center dot when connected | 8x8px raised square pins protruding 2px outside the node frame | Protruding square pins on the exterior border free up internal horizontal space for labels. |
| **Typography** | **Topaz** (8px) or **XEN** (9px proportional crisp bitmap) | **MS Sans Serif** (8pt non-antialiased) or **Fixedsys** | Use crisp pixel/bitmap fonts (like *ibmvga8*, *ProggyClean*, or *Unscii*) for port labels and live value readouts. |

