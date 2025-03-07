package is.hail.backend

import is.hail.expr.ir.IRParser
import is.hail.utils._

import scala.util.control.NonFatal

import java.io.Closeable
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent._

import com.sun.net.httpserver.{HttpExchange, HttpHandler, HttpServer}
import org.json4s._
import org.json4s.jackson.JsonMethods
import org.json4s.jackson.JsonMethods.compact

case class IRTypePayload(ir: String)
case class LoadReferencesFromDatasetPayload(path: String)

case class FromFASTAFilePayload(
  name: String,
  fasta_file: String,
  index_file: String,
  x_contigs: Array[String],
  y_contigs: Array[String],
  mt_contigs: Array[String],
  par: Array[String],
)

case class ParseVCFMetadataPayload(path: String)
case class ImportFamPayload(path: String, quant_pheno: Boolean, delimiter: String, missing: String)
case class ExecutePayload(ir: String, stream_codec: String, timed: Boolean)

class BackendServer(backend: Backend) extends Closeable {
  // 0 => let the OS pick an available port
  private[this] val httpServer = HttpServer.create(new InetSocketAddress(0), 10)
  private[this] val handler = new BackendHttpHandler(backend)

  private[this] val thread = {
    // This HTTP server *must not* start non-daemon threads because such threads keep the JVM
    // alive. A living JVM indicates to Spark that the job is incomplete. This does not manifest
    // when you run jobs in a local pyspark (because you'll Ctrl-C out of Python regardless of the
    // JVM's state) nor does it manifest in a Notebook (again, you'll kill the Notebook kernel
    // explicitly regardless of the JVM). It *does* manifest when submitting jobs with
    //
    //     gcloud dataproc submit ...
    //
    // or
    //
    //     spark-submit
    //
    // setExecutor(null) ensures the server creates no new threads:
    //
    // > If this method is not called (before start()) or if it is called with a null Executor, then
    // > a default implementation is used, which uses the thread which was created by the start()
    // > method.
    //
    /* Source:
     * https://docs.oracle.com/en/java/javase/11/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpServer.html#setExecutor(java.util.concurrent.Executor) */
    //
    httpServer.createContext("/", handler)
    httpServer.setExecutor(null)
    val t = Executors.defaultThreadFactory().newThread(new Runnable() {
      def run(): Unit =
        httpServer.start()
    })
    t.setDaemon(true)
    t
  }

  def port = httpServer.getAddress.getPort

  def start(): Unit =
    thread.start()

  override def close(): Unit =
    httpServer.stop(10)
}

class BackendHttpHandler(backend: Backend) extends HttpHandler {
  def handle(exchange: HttpExchange): Unit = {
    implicit val formats: Formats = DefaultFormats

    try {
      val body = using(exchange.getRequestBody)(JsonMethods.parse(_))
      if (exchange.getRequestURI.getPath == "/execute") {
        val ExecutePayload(irStr, streamCodec, timed) = body.extract[ExecutePayload]
        backend.withExecuteContext { ctx =>
          val (res, timings) = ExecutionTimer.time { timer =>
            ctx.local(timer = timer) { ctx =>
              val irData = IRParser.parse_value_ir(ctx, irStr)
              backend.execute(ctx, irData)
            }
          }

          if (timed) {
            exchange.getResponseHeaders.add("X-Hail-Timings", compact(timings.toJSON))
          }

          res match {
            case Left(_) => exchange.sendResponseHeaders(200, -1L)
            case Right((t, off)) =>
              exchange.sendResponseHeaders(200, 0L) // 0 => an arbitrarily long response body
              using(exchange.getResponseBody) { os =>
                Backend.encodeToOutputStream(ctx, t, off, streamCodec, os)
              }
          }
        }
        return
      }

      val response: Array[Byte] = exchange.getRequestURI.getPath match {
        case "/value/type" => backend.valueType(body.extract[IRTypePayload].ir)
        case "/table/type" => backend.tableType(body.extract[IRTypePayload].ir)
        case "/matrixtable/type" => backend.matrixTableType(body.extract[IRTypePayload].ir)
        case "/blockmatrix/type" => backend.blockMatrixType(body.extract[IRTypePayload].ir)
        case "/references/load" =>
          backend.loadReferencesFromDataset(body.extract[LoadReferencesFromDatasetPayload].path)
        case "/references/from_fasta" =>
          val config = body.extract[FromFASTAFilePayload]
          backend.fromFASTAFile(
            config.name,
            config.fasta_file,
            config.index_file,
            config.x_contigs,
            config.y_contigs,
            config.mt_contigs,
            config.par,
          )
        case "/vcf/metadata/parse" =>
          backend.parseVCFMetadata(body.extract[ParseVCFMetadataPayload].path)
        case "/fam/import" =>
          val config = body.extract[ImportFamPayload]
          backend.importFam(config.path, config.quant_pheno, config.delimiter, config.missing)
      }

      exchange.sendResponseHeaders(200, response.length)
      using(exchange.getResponseBody())(_.write(response))
    } catch {
      case NonFatal(t) =>
        val (shortMessage, expandedMessage, errorId) = handleForPython(t)
        val errorJson = JObject(
          "short" -> JString(shortMessage),
          "expanded" -> JString(expandedMessage),
          "error_id" -> JInt(errorId),
        )
        val errorBytes = JsonMethods.compact(errorJson).getBytes(StandardCharsets.UTF_8)
        exchange.sendResponseHeaders(500, errorBytes.length)
        using(exchange.getResponseBody())(_.write(errorBytes))
    }
  }
}
