# 二期起的 Postgres 镜像：pgvector（向量检索）+ zhparser（中文全文分词）。
# - pgvector 用官方镜像内置，无需自编。
# - zhparser 无现成 apt 包，需从源码编译，且依赖中文分词库 SCWS（先编 SCWS 再编 zhparser）。
# 镜像只负责把扩展的 .so/.control 装进 PG；启用（CREATE EXTENSION）放在 Kysely migration 里。
FROM pgvector/pgvector:pg16

# 编译依赖 + PG 开发头文件（pg_config 来自 postgresql-server-dev-16）
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates wget bison flex \
      postgresql-server-dev-16 \
 && rm -rf /var/lib/apt/lists/*

# 1) SCWS —— zhparser 依赖的中文分词 C 库，装到 /usr/local（zhparser 默认从此处找）
RUN wget -q http://www.xunsearch.com/scws/down/scws-1.2.3.tar.bz2 \
 && tar xjf scws-1.2.3.tar.bz2 \
 && cd scws-1.2.3 \
 && ./configure --prefix=/usr/local \
 && make && make install \
 && ldconfig \
 && cd / && rm -rf scws-1.2.3*

# 2) zhparser —— PG 扩展（PGXS 编译，默认链接 /usr/local 下的 SCWS）
RUN wget -q -O zhparser.tar.gz \
      https://github.com/amutu/zhparser/archive/refs/heads/master.tar.gz \
 && tar xzf zhparser.tar.gz \
 && cd zhparser-master \
 && make && make install \
 && cd / && rm -rf zhparser-master zhparser.tar.gz
