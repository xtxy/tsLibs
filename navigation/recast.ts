import earcut from 'earcut';

type Point = { x: number; y: number };
type Polygon = Point[];

/**
 * 使用 earcut 划分可行走区域为凸多边形
 * @param boundingBox 矩形边界 [左上，右上，右下，左下]（顺时针）
 * @param obstacles 凸多边形障碍物数组（每个障碍物顺时针）
 * @returns 可行走区域的凸多边形列表
 */
export function decomposeWalkableArea(
    boundingBox: Polygon,
    obstacles: Polygon[]
): Polygon[] {
    validateInput(boundingBox, obstacles);

    // 1. 合并所有几何数据（外框+障碍物孔洞）
    const { vertices, holes } = prepareEarcutInput(boundingBox, obstacles);

    // 2. 执行三角剖分
    const triangles = triangulateWithEarcut(vertices, holes);

    // 3. 合并相邻三角形为凸多边形
    return mergeTrianglesToConvexPolygons(triangles);
}

function validateInput(boundingBox: Polygon, obstacles: Polygon[]) {
    if (boundingBox.length !== 4) throw new Error("矩形区域必须为4个点");
    obstacles.forEach((obstacle, i) => {
        if (obstacle.length < 3) throw new Error(`障碍物${i + 1}至少需要3个点`);
        if (!isConvex(obstacle)) throw new Error(`障碍物${i + 1}必须是凸多边形`);
    });
}

/** 凸性检测（向量叉积法） */
function isConvex(poly: Polygon): boolean {
    const n = poly.length;
    if (n < 3) {
        return false;
    }

    let sign = 0;
    for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        const c = poly[(i + 2) % n];

        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (cross !== 0) {
            if (sign === 0) {
                sign = Math.sign(cross);
            } else if (Math.sign(cross) !== sign) {
                return false;
            }
        }
    }
    return true;
}

/** 准备 earcut 输入数据 */
function prepareEarcutInput(
    boundingBox: Polygon,
    obstacles: Polygon[]
): { vertices: number[]; holes: number[] } {
    // 合并所有顶点到一维数组 [x0,y0, x1,y1, ...]
    const vertices: number[] = [];
    const holes: number[] = [];

    // 添加外框（矩形）
    boundingBox.forEach(p => {
        vertices.push(p.x, p.y);
    });

    // 添加障碍物（孔洞）
    let vertexOffset = boundingBox.length;
    obstacles.forEach(obstacle => {
        holes.push(vertexOffset); // 记录孔洞起始索引
        obstacle.forEach(p => {
            vertices.push(p.x, p.y);
        });
        vertexOffset += obstacle.length;
    });

    return { vertices, holes };
}

/** 使用 earcut 进行三角剖分 */
function triangulateWithEarcut(
    vertices: number[],
    holes: number[]
): Polygon[] {
    // 执行剖分（返回三角形顶点索引）
    const indices = earcut(vertices, holes, 2);

    // 将索引转换为三角形顶点数组
    const triangles: Polygon[] = [];
    for (let i = 0; i < indices.length; i += 3) {
        const tri: Polygon = [];
        for (let j = 0; j < 3; j++) {
            const idx = indices[i + j] * 2;
            tri.push({ x: vertices[idx], y: vertices[idx + 1] });
        }
        triangles.push(tri);
    }
    return triangles;
}

/** 合并三角形为凸多边形（与 poly2tri 方案兼容） */
function mergeTrianglesToConvexPolygons(triangles: Polygon[]): Polygon[] {
    // 邻接图：记录共享边的三角形
    const adjacencyMap = new Map<number, number[]>();
    for (let i = 0; i < triangles.length; i++) {
        adjacencyMap.set(i, []);

        for (let j = 0; j < triangles.length; j++) {
            if (i == j || !shareEdge(triangles[i], triangles[j])) {
                continue;
            }

            adjacencyMap.get(i)!.push(j);
        }
    }

    // 合并相邻三角形
    const visited = new Set<number>();
    const result: Polygon[] = [];

    for (let i = 0; i < triangles.length; i++) {
        if (visited.has(i)) {
            continue;
        }

        let mergedPoly = [...triangles[i]];
        visited.add(i);

        for (const neighborIdx of adjacencyMap.get(i) || []) {
            if (visited.has(neighborIdx)) {
                continue;
            }

            const candidate = mergePolygons(mergedPoly, triangles[neighborIdx]);
            if (candidate && isConvex(candidate)) {
                mergedPoly = candidate;
                visited.add(neighborIdx);
            }
        }

        result.push(mergedPoly);
    }

    return result;
}

// ----------- 以下工具函数与 poly2tri 方案相同 -----------
/** 检查两个三角形是否共享边 */
function shareEdge(tri1: Polygon, tri2: Polygon): boolean {
    const edges1 = getEdges(tri1);
    const edges2 = getEdges(tri2);
    return edges1.some(e1 =>
        edges2.some(e2 =>
            (pointsEqual(e1[0], e2[0]) && pointsEqual(e1[1], e2[1])) ||
            (pointsEqual(e1[0], e2[1]) && pointsEqual(e1[1], e2[0]))
        )
    );
}

/** 获取多边形的边 */
function getEdges(poly: Polygon): [Point, Point][] {
    return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
}

/** 合并两个多边形 */
function mergePolygons(poly1: Polygon, poly2: Polygon): Polygon | null {
    const sharedEdge = findSharedEdge(poly1, poly2);
    if (!sharedEdge) {
        return null;
    }

    const edgeStart = sharedEdge[0];
    const newPoly: Polygon = [];

    let index = poly2.findIndex(p => pointsEqual(p, edgeStart));
    index = (index + 1) % poly2.length;

    for (const p of poly1) {
        newPoly.push(p);

        if (!pointsEqual(p, edgeStart)) {
            continue;
        }

        for (let i = 1; i < poly2.length - 1; i++) {
            const p2 = poly2[index];
            newPoly.push(p2);
            index = (index + 1) % poly2.length;
        }
    }

    return newPoly;
}

/** 查找共享边 */
function findSharedEdge(poly1: Polygon, poly2: Polygon): [Point, Point] | null {
    const edges1 = getEdges(poly1);
    for (const edge of edges1) {
        const [a, b] = edge;
        for (const edge2 of getEdges(poly2)) {
            const [c, d] = edge2;
            if (
                (pointsEqual(a, c) && pointsEqual(b, d)) ||
                (pointsEqual(a, d) && pointsEqual(b, c))
            ) {
                return [a, b];
            }
        }
    }
    return null;
}

/** 比较点是否相等（容差 1e-6） */
function pointsEqual(a: Point, b: Point): boolean {
    return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}