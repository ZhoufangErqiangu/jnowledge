# 二期起的 Postgres 镜像：pgvector（向量检索）+ zhparser（中文全文分词）。
# - pgvector 用官方镜像内置，无需自编。
# - zhparser 无现成 apt 包，需从源码编译，且依赖中文分词库 SCWS（先编 SCWS 再编 zhparser）。
# 镜像只负责把扩展的 .so/.control 装进 PG；启用（CREATE EXTENSION）放在 Kysely migration 里。

# ── 第一阶段：编译 ────────────────────────────────────────────────────────────
FROM pgvector/pgvector:pg16 AS builder

# 编译依赖 + PG 开发头文件（pg_config 来自 postgresql-server-dev-16）
# autoconf/automake/libtool 用于从 GitHub 源码生成 configure（scws 仓库无预生成脚本）
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates wget bison flex \
      autoconf automake libtool \
      postgresql-server-dev-16 \
 && rm -rf /var/lib/apt/lists/*

# 1) SCWS —— zhparser 依赖的中文分词 C 库，装到 /usr/local（zhparser 默认从此处找）
#    1.2.3 无 tag，固定到对应 commit（"发布 1.2.3 版"）
ARG SCWS_COMMIT=a04ef5e655213eb6b07fb57761d0eac72c281ad4
RUN wget -q -O scws.tar.gz \
      https://github.com/hightman/scws/archive/${SCWS_COMMIT}.tar.gz \
 && tar xzf scws.tar.gz \
 && cd scws-${SCWS_COMMIT} \
 && ./acprep \
 && ./configure --prefix=/usr/local \
 && make && make install \
 && cd / && rm -rf scws-${SCWS_COMMIT} scws.tar.gz

# 2) zhparser —— PG 扩展（PGXS 编译，默认链接 /usr/local 下的 SCWS）
ARG ZHPARSER_TAG=v2.3
RUN wget -q -O zhparser.tar.gz \
      https://github.com/amutu/zhparser/archive/refs/tags/${ZHPARSER_TAG}.tar.gz \
 && tar xzf zhparser.tar.gz \
 && cd zhparser-2.3 \
 && make && make install \
 && cd / && rm -rf zhparser-2.3 zhparser.tar.gz

# ── 第二阶段：运行时镜像 ──────────────────────────────────────────────────────
FROM pgvector/pgvector:pg16

# SCWS 运行时共享库（zhparser.so 已通过 -Wl,-rpath 嵌入 /usr/local/lib）
COPY --from=builder /usr/local/lib/libscws*  /usr/local/lib/

# zhparser PG 扩展：.so + .control + .sql
COPY --from=builder /usr/lib/postgresql/16/lib/zhparser.so \
                    /usr/lib/postgresql/16/lib/
COPY --from=builder /usr/share/postgresql/16/extension/zhparser* \
                    /usr/share/postgresql/16/extension/

# zhparser 自带词典（DATA_TSEARCH，装进 PG 的 tsearch_data）
COPY --from=builder /usr/share/postgresql/16/tsearch_data/dict.utf8.xdb \
                    /usr/share/postgresql/16/tsearch_data/rules.utf8.ini \
                    /usr/share/postgresql/16/tsearch_data/
